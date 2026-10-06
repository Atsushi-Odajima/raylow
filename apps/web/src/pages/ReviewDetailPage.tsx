/**
 * S07 /reviews/:id: 版/宛先 → 差分（旧承認版 vs 新版）→ 警告 → 本文と最終 PDF → 承認 / 理由付き差戻し。
 * hashCurrent=false は「再生成が必要」。古い版の承認は 409（hash_stale）→ 再読込。
 */
import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { astToPlainText } from '@raylow/template-schema';
import { useAddReviewComment, useResolveReviewComment, useReview, useReviewDecision } from '../api/reviews';
import { isApiError } from '../lib/apiClient';
import { outputDownloadUrl } from '../lib/download';
import { formatDateTime, shortHash } from '../lib/format';
import { RECIPIENT_TYPE_LABEL, REVIEW_STATUS_LABEL, draftStatusLabel, label } from '../lib/labels';
import { useIsDesktop } from '../hooks/useMediaQuery';
import { Alert } from '../components/Alert';
import { AstView } from '../components/AstView';
import { Badge, SampleOnlyBadge, statusTone } from '../components/Badge';
import { Button, LinkButton } from '../components/Button';
import { DiffView } from '../components/DiffView';
import { Field } from '../components/Field';
import { PageHeader } from '../components/PageHeader';
import { PdfPreview } from '../components/PdfPreview';
import { LegalReviewNote, PreflightIssueRow } from '../components/PreflightList';
import { ErrorState, LoadingState } from '../components/States';
import { Tabs } from '../components/Tabs';
import { TextArea } from '../components/TextArea';
import { Icon } from '../components/Icon';

type MobileTab = 'old' | 'new' | 'diff' | 'pdf';

export function ReviewDetailPage() {
  const { id } = useParams();
  const isDesktop = useIsDesktop();
  const q = useReview(id);
  const decide = useReviewDecision();
  const addComment = useAddReviewComment();
  const resolve = useResolveReviewComment();
  const [reason, setReason] = useState('');
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [comment, setComment] = useState('');
  const [mtab, setMtab] = useState<MobileTab>('new');
  const [err, setErr] = useState<string | null>(null);

  const d = q.data;
  const oldText = useMemo(() => (d?.previousApprovedRevision ? astToPlainText(d.previousApprovedRevision.ast) : ''), [d]);
  const newText = useMemo(() => (d ? astToPlainText(d.revision.ast) : ''), [d]);
  const pdf = useMemo(() => d?.outputs.filter((o) => o.format === 'pdf' && o.status === 'ready' && o.revisionId === d.revision.id).sort((a, b) => (a.mode === 'final' ? -1 : b.mode === 'final' ? 1 : a.createdAt < b.createdAt ? 1 : -1))[0] ?? null, [d]);
  const confirms = useMemo(() => d?.preflight?.issues.filter((i) => i.severity === 'confirm') ?? [], [d]);
  const warnings = useMemo(() => d?.preflight?.issues.filter((i) => i.severity === 'warning') ?? [], [d]);
  const errors = useMemo(() => d?.preflight?.issues.filter((i) => i.severity === 'error') ?? [], [d]);
  const changedFields = useMemo(() => {
    if (!d) return [];
    const prev = d.previousApprovedRevision?.snapshot.fields ?? {};
    const cur = d.revision.snapshot.fields;
    const keys = new Set([...Object.keys(prev), ...Object.keys(cur)]);
    const str = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : JSON.stringify(v));
    return [...keys].map((k) => ({ key: k, before: str(prev[k]?.displayValue ?? prev[k]?.rawValue), after: str(cur[k]?.displayValue ?? cur[k]?.rawValue) })).filter((x) => x.before !== x.after);
  }, [d]);

  if (q.isLoading) return <div className="container"><LoadingState label="レビューを読み込んでいます…" /></div>;
  if (q.isError || !d || !id) return <div className="container" style={{ paddingTop: 'var(--space-6)' }}><ErrorState error={q.error ?? new Error('not found')} onRetry={() => void q.refetch()} /></div>;

  const pending = d.review.status === 'pending';
  const missingReasons = confirms.filter((c) => !(reasons[c.code] ?? '').trim());
  const approveBlock = !pending ? '決定済みのレビューです' : !d.canDecide ? d.denialReason ?? 'このレビューを決定する権限がありません' : !d.hashCurrent ? '版の hash が現在と一致しません。再生成が必要です' : errors.length > 0 ? '停止エラーが残っています' : missingReasons.length > 0 ? `要確認項目 ${missingReasons.length} 件に理由を入力してください` : !pdf ? '承認対象の PDF がありません。再生成してください' : undefined;
  const rejectBlock = !pending ? '決定済みのレビューです' : !d.canDecide ? d.denialReason ?? 'このレビューを決定する権限がありません' : !reason.trim() ? '差戻し理由を入力してください' : undefined;

  const submit = async (decision: 'approved' | 'changes_requested') => {
    setErr(null);
    try {
      await decide.mutateAsync({
        id,
        input: {
          decision,
          targetHash: d.review.targetHash,
          targetOutputPdfSha256: pdf?.sha256 ?? d.review.targetOutputPdfSha256 ?? null,
          expectedVersion: d.review.version,
          ...(reason.trim() ? { reason: reason.trim() } : {}),
          confirmations: confirms.map((c) => ({ code: c.code, reason: (reasons[c.code] ?? '').trim() })).filter((c) => c.reason.length > 0),
        },
      });
    } catch (e) {
      if (isApiError(e) && e.isConflict) {
        setErr(e.code === 'hash_stale' ? '対象の版が更新されています（hash 不一致）。再読込して最新の版を確認してください。' : e.userMessage());
        void q.refetch();
      } else if (isApiError(e) && e.code === 'approval_denied') setErr(`承認できません: ${e.message}`);
      else setErr(isApiError(e) ? e.userMessage() : '決定に失敗しました');
    }
  };

  const oldPane = d.previousApprovedRevision ? (
    <div className="stack-s">
      <div className="aux muted">旧承認版 revision {d.previousApprovedRevision.revision}（{formatDateTime(d.previousApprovedRevision.createdAt)}）</div>
      <AstView ast={d.previousApprovedRevision.ast} />
    </div>
  ) : (
    <div className="state-box muted">承認済みの旧版はありません（初回レビュー）。</div>
  );
  const newPane = (
    <div className="stack-s">
      <div className="aux muted">
        新版 revision {d.revision.revision}（{d.revision.createdByName ?? '—'} ／ {formatDateTime(d.revision.createdAt)} ／ {d.revision.kind === 'external_edit' ? 'Word 外部編集版' : 'アプリ編集'}）
      </div>
      <AstView ast={d.revision.ast} />
    </div>
  );
  const diffPane = (
    <div className="stack">
      <DiffView before={oldText} after={newText} label="本文の原文差分" />
      <section>
        <h3 style={{ marginBottom: 'var(--space-2)' }}>差込項目の変更 <span className="aux muted num">{changedFields.length} 件</span></h3>
        {changedFields.length === 0 ? <p className="muted aux">差込項目の変更はありません。</p> : (
          <div className="table-wrap">
            <table className="table">
              <caption className="sr-only">差込項目の変更</caption>
              <thead><tr><th scope="col">項目</th><th scope="col">旧</th><th scope="col">新</th></tr></thead>
              <tbody>{changedFields.map((f) => <tr key={f.key}><td className="mono">{f.key}</td><td className="cell-raw"><del>{f.before || '（空）'}</del></td><td className="cell-raw"><ins>{f.after || '（空）'}</ins></td></tr>)}</tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
  const pdfPane = (
    <div className="stack-s">
      <div className="row aux">
        <Icon name="document" size={16} />
        {pdf ? <span>{pdf.mode === 'final' ? '正式' : '草案'} PDF ／ sha256 {shortHash(pdf.sha256)} ／ {formatDateTime(pdf.createdAt)}</span> : <span className="muted">この版の PDF がありません</span>}
        {d.review.targetOutputPdfSha256 ? <Badge tone={pdf && pdf.sha256 === d.review.targetOutputPdfSha256 ? 'success' : 'warning'}>{pdf && pdf.sha256 === d.review.targetOutputPdfSha256 ? '依頼時の PDF hash と一致' : '依頼時の PDF hash と不一致'}</Badge> : null}
      </div>
      <PdfPreview src={pdf ? outputDownloadUrl(pdf.id, pdf.mode) : null} version={pdf?.id} emptyLabel="この版の PDF はまだ生成されていません。編集画面で「プレビューを更新」してください。" />
    </div>
  );

  return (
    <div className="container">
      <PageHeader
        title="弁護士確認"
        lead={`${d.draft.titleRaw} ／ ${d.draft.matterTitleRaw}`}
        crumbs={[{ to: '/reviews', label: '確認待ち' }, { label: `レビュー ${d.review.id.slice(0, 8)}` }]}
        actions={
          <>
            <LinkButton to={`/drafts/${d.draft.id}/edit`} icon="portal">編集画面</LinkButton>
            <Button variant="primary" icon="check" onClick={() => void submit('approved')} busy={decide.isPending} disabledReason={approveBlock}>
              承認
            </Button>
          </>
        }
      />
      <div className="stack">
        <div className="row aux">
          <Badge tone={statusTone(d.review.status)}>{label(REVIEW_STATUS_LABEL, d.review.status)}</Badge>
          <Badge tone={statusTone(d.draft.status)}>草案: {draftStatusLabel(d.draft.status)}</Badge>
          <span className="num">版 {d.revision.revision}{d.previousApprovedRevision ? `（旧承認版 ${d.previousApprovedRevision.revision}）` : ''}</span>
          <span>宛先: {RECIPIENT_TYPE_LABEL[d.revision.snapshot.recipient.type]} {d.revision.snapshot.recipient.nameRaw}{d.revision.snapshot.recipient.organizationNameRaw ? `（${d.revision.snapshot.recipient.organizationNameRaw}）` : ''}</span>
          <span>依頼: {d.review.requestedByName ?? '—'} ／ 確認者: {d.review.reviewerName ?? '—'}</span>
          <span>対象 hash {shortHash(d.review.targetHash)}</span>
          {d.revision.snapshot.recipient.confirmedDirectToOpponent ? <Badge tone="warning">代理人がいるが本人宛て</Badge> : null}
        </div>
        {!d.hashCurrent ? (
          <Alert kind="error" title="再生成が必要" actions={<LinkButton to={`/drafts/${d.draft.id}/edit`} small>編集画面で保存・再生成</LinkButton>}>
            レビュー対象の hash が現在の版と一致しません。草案が編集された可能性があります。最新の版で再度レビューを依頼してください。
          </Alert>
        ) : null}
        {!d.canDecide && pending ? <Alert kind="info" title="この画面では決定できません">{d.denialReason ?? '割当された弁護士（最終編集者以外）のみ承認・差戻しができます。'}</Alert> : null}
        {d.review.status !== 'pending' ? (
          <Alert kind={d.review.status === 'approved' ? 'success' : 'info'} title={`${label(REVIEW_STATUS_LABEL, d.review.status)}（${formatDateTime(d.review.decidedAt)}）`}>
            {d.review.decisionReason ? <span className="pre">{d.review.decisionReason}</span> : null}
            {d.review.status === 'approved' ? <div><Link to={`/documents/${d.draft.id}/output`}>正式 DOCX/PDF の取得へ</Link></div> : null}
          </Alert>
        ) : null}
        {err ? <Alert kind="error" live>{err}</Alert> : null}

        {isDesktop ? (
          <div className="compare">
            <section className="stack-s"><h2 style={{ fontSize: 18 }}>旧（承認版）</h2>{oldPane}</section>
            <section className="stack-s"><h2 style={{ fontSize: 18 }}>新（レビュー対象）</h2>{newPane}</section>
          </div>
        ) : (
          <Tabs<MobileTab> label="比較" value={mtab} onChange={setMtab} items={[{ key: 'old', label: '旧' }, { key: 'new', label: '新' }, { key: 'diff', label: '差分' }, { key: 'pdf', label: 'PDF' }]}>
            {(k) => (k === 'old' ? oldPane : k === 'new' ? newPane : k === 'diff' ? diffPane : pdfPane)}
          </Tabs>
        )}
        {isDesktop ? (
          <div className="compare">
            <section className="stack-s"><h2 style={{ fontSize: 18 }}>差分</h2>{diffPane}</section>
            <section className="stack-s"><h2 style={{ fontSize: 18 }}>最終 PDF</h2>{pdfPane}</section>
          </div>
        ) : null}

        <div className="grid-12">
          <section className="col-6 band stack" aria-labelledby="h-warn">
            <h2 id="h-warn" style={{ fontSize: 18 }}>形式検査の結果</h2>
            {errors.length > 0 ? <ul className="rowlist">{errors.map((i, k) => <PreflightIssueRow key={k} issue={i} draftId={d.draft.id} />)}</ul> : null}
            {warnings.length > 0 ? <ul className="rowlist">{warnings.map((i, k) => <PreflightIssueRow key={k} issue={i} draftId={d.draft.id} />)}</ul> : null}
            {confirms.map((c) => (
              <Field key={c.code} label={<>要確認: {c.message} <span className="aux muted mono">{c.code}</span></>} required={pending && d.canDecide}>
                {({ id: fid }) => <TextArea id={fid} short value={reasons[c.code] ?? ''} onValueChange={(v) => setReasons((r) => ({ ...r, [c.code]: v }))} disabled={!pending || !d.canDecide} placeholder="確認した理由（承認時に記録されます）" />}
              </Field>
            ))}
            {errors.length + warnings.length + confirms.length === 0 ? <p className="muted">検査で指摘はありません。</p> : null}
            <LegalReviewNote report={d.preflight} />
          </section>
          <section className="col-6 band stack" aria-labelledby="h-decide">
            <h2 id="h-decide" style={{ fontSize: 18 }}>決定</h2>
            <Field label="差戻し理由（差戻し時は必須・承認時は任意のコメント）">
              {({ id: fid }) => <TextArea id={fid} value={reason} onValueChange={setReason} disabled={!pending || !d.canDecide} />}
            </Field>
            <div className="row">
              <Button variant="primary" icon="check" onClick={() => void submit('approved')} busy={decide.isPending} disabledReason={approveBlock}>
                承認
              </Button>
              <Button variant="danger" onClick={() => void submit('changes_requested')} busy={decide.isPending} disabledReason={rejectBlock}>
                差戻し
              </Button>
            </div>
            <p className="aux muted">承認は AST・入力 snapshot・書式 hash・出力 DOCX/PDF hash・添付 manifest・renderer profile の組に対して行われ、サーバーで再検証されます。</p>
            <h3>コメント</h3>
            <ul className="stack-s">
              {d.comments.length === 0 ? <li className="muted aux">コメントはありません。</li> : null}
              {d.comments.map((c) => (
                <li key={c.id} className="notice-box">
                  <div className="aux muted">{c.createdByName ?? '—'} ／ {formatDateTime(c.createdAt)}{c.blockId ? ` ／ 段落 ${c.blockId}` : ''}{c.fieldKey ? ` ／ 項目 ${c.fieldKey}` : ''}{c.resolvedAt ? ' ／ 解決済み' : ''}</div>
                  <div className="pre">{c.bodyRaw}</div>
                  {!c.resolvedAt ? <div style={{ marginTop: 'var(--space-2)' }}><Button small onClick={() => resolve.mutate({ commentId: c.id, reviewId: id })}>解決済みにする</Button></div> : null}
                </li>
              ))}
            </ul>
            <form className="stack-s" onSubmit={(e) => { e.preventDefault(); if (comment.trim()) void addComment.mutateAsync({ id, bodyRaw: comment.trim() }).then(() => setComment('')); }}>
              <Field label="コメントを追加">{({ id: fid }) => <TextArea id={fid} short value={comment} onValueChange={setComment} />}</Field>
              <div><Button type="submit" small busy={addComment.isPending} disabledReason={!comment.trim() ? '本文を入力してください' : undefined}>追加</Button></div>
            </form>
          </section>
        </div>
        {d.outputs.length > 0 ? (
          <section className="band">
            <h2 style={{ fontSize: 18, marginBottom: 'var(--space-2)' }}>出力一覧</h2>
            <div className="table-wrap">
              <table className="table">
                <caption className="sr-only">出力</caption>
                <thead><tr><th scope="col">形式</th><th scope="col">区分</th><th scope="col">状態</th><th scope="col">sha256</th><th scope="col">生成</th></tr></thead>
                <tbody>{d.outputs.map((o) => <tr key={o.id}><td>{o.format.toUpperCase()}</td><td>{o.mode === 'final' ? '正式' : '草案'}</td><td>{o.status}</td><td className="mono">{shortHash(o.sha256)}</td><td>{formatDateTime(o.createdAt)}</td></tr>)}</tbody>
              </table>
            </div>
          </section>
        ) : null}
        {d.draft.status === 'approved' ? <div><SampleOnlyBadge /></div> : null}
      </div>
    </div>
  );
}
