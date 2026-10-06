/**
 * S06 /drafts/:id/check: 停止エラー → 確認警告（理由必須） → 最終プレビュー → レビュー依頼。
 * 形式検査と法的審査は別表示。エラー時は関連 block/field へ戻す。
 */
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { draftKeys, renderDraft, requestReview, useDraft, usePreflight } from '../api/drafts';
import { useJob } from '../api/jobs';
import { useMembers } from '../api/masters';
import { isApiError } from '../lib/apiClient';
import { outputDownloadUrl } from '../lib/download';
import { formatDateTime } from '../lib/format';
import { RECIPIENT_TYPE_LABEL, draftStatusLabel } from '../lib/labels';
import { useSession } from '../lib/session';
import { Alert } from '../components/Alert';
import { Badge, SampleOnlyBadge, statusTone } from '../components/Badge';
import { Button, LinkButton } from '../components/Button';
import { Field } from '../components/Field';
import { JobProgress } from '../components/JobProgress';
import { PageHeader } from '../components/PageHeader';
import { PdfPreview } from '../components/PdfPreview';
import { LegalReviewNote, PreflightIssueRow } from '../components/PreflightList';
import { Select } from '../components/Select';
import { ErrorState, LoadingState } from '../components/States';
import { TextArea } from '../components/TextArea';
import { Icon } from '../components/Icon';

export function DraftCheckPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const session = useSession();
  const draft = useDraft(id);
  const preflight = usePreflight(id);
  const members = useMembers();
  const [reviewerId, setReviewerId] = useState('');
  const [note, setNote] = useState('');
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [submitErr, setSubmitErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [renderJobId, setRenderJobId] = useState<string | null>(null);
  const renderJob = useJob(renderJobId);
  useEffect(() => {
    const j = renderJob.data;
    if (j && renderJobId && (j.state === 'succeeded' || j.state === 'failed')) {
      void qc.invalidateQueries({ queryKey: draftKeys.detail(id ?? '') });
      void preflight.refetch();
      if (j.state === 'succeeded') setRenderJobId(null);
    }
  }, [renderJob.data, renderJobId, id, qc, preflight]);

  const d = draft.data;
  const report = preflight.data;
  const errors = useMemo(() => report?.issues.filter((i) => i.severity === 'error') ?? [], [report]);
  const confirms = useMemo(() => report?.issues.filter((i) => i.severity === 'confirm') ?? [], [report]);
  const warnings = useMemo(() => report?.issues.filter((i) => i.severity === 'warning') ?? [], [report]);
  const currentRevisionId = d?.currentRevision?.id ?? null;
  const pdf = useMemo(() => d?.outputs.filter((o) => o.format === 'pdf' && o.mode === 'draft' && o.status === 'ready' && o.revisionId === currentRevisionId).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0] ?? null, [d, currentRevisionId]);

  const me = session.info?.user?.id ?? null;
  const lastEditor = d?.currentRevision?.createdBy ?? null;
  const reviewers = (members.data ?? []).filter((m) => m.role === 'lawyer' && m.status === 'active');
  const reviewerOptions = reviewers.map((m) => ({
    value: m.userId,
    label: `${m.displayName}${m.userId === me ? '（自分: 自己承認不可）' : m.userId === lastEditor ? '（最終編集者: 承認不可）' : ''}`,
    disabled: m.userId === me || m.userId === lastEditor,
  }));
  const missingReasons = confirms.filter((c) => !(reasons[c.code] ?? '').trim());
  const blockReason = errors.length > 0 ? `停止エラーが ${errors.length} 件あります。修正してから依頼してください` : !reviewerId ? '確認する弁護士を選んでください' : missingReasons.length > 0 ? `要確認項目 ${missingReasons.length} 件に理由を入力してください` : d && !d.canEdit ? 'この草案を操作する権限がありません' : d?.openReviewId ? '既にレビュー依頼中です' : undefined;

  const submit = async () => {
    if (!id || blockReason) return;
    setBusy(true);
    setSubmitErr(null);
    try {
      const confirmText = confirms.length > 0 ? `\n\n【要確認項目への確認理由】\n${confirms.map((c) => `- ${c.code}: ${(reasons[c.code] ?? '').trim()}`).join('\n')}` : '';
      const r = await requestReview(id, reviewerId, `${note.trim()}${confirmText}`.trim() || undefined);
      void qc.invalidateQueries({ queryKey: draftKeys.detail(id) });
      void qc.invalidateQueries({ queryKey: ['home'] });
      navigate(`/reviews/${r.id}`);
    } catch (e) {
      if (isApiError(e) && e.isValidation) {
        setSubmitErr(`${e.userMessage()} 検査結果を再読込しました。`);
        void preflight.refetch();
      } else setSubmitErr(isApiError(e) ? e.userMessage() : 'レビュー依頼に失敗しました');
    } finally {
      setBusy(false);
    }
  };

  const regenerate = async () => {
    if (!id) return;
    try {
      const r = await renderDraft(id, 'draft');
      setRenderJobId(r.jobId);
    } catch (e) {
      setSubmitErr(isApiError(e) ? e.userMessage() : 'プレビュー生成を開始できませんでした');
    }
  };

  if (draft.isLoading || preflight.isLoading) return <div className="container"><LoadingState label="形式検査を実行しています…" /></div>;
  if (draft.isError || !d || !id) return <div className="container" style={{ paddingTop: 'var(--space-6)' }}><ErrorState error={draft.error ?? new Error('not found')} onRetry={() => void draft.refetch()} /></div>;

  return (
    <div className="container">
      <PageHeader
        title="形式検査"
        lead={`${d.draft.titleRaw} ／ ${d.draft.matterTitleRaw} ／ 版 ${d.currentRevision?.revision ?? '—'}`}
        crumbs={[{ to: '/documents', label: '書類' }, { to: `/drafts/${id}/edit`, label: '編集' }, { label: '形式検査' }]}
        actions={
          <>
            <LinkButton to={`/drafts/${id}/edit`} icon="portal">
              編集に戻る
            </LinkButton>
            <Button variant="primary" icon="review" onClick={() => void submit()} busy={busy} disabledReason={blockReason}>
              レビューを依頼
            </Button>
          </>
        }
      />
      {preflight.isError ? <ErrorState error={preflight.error} onRetry={() => void preflight.refetch()} title="形式検査を実行できませんでした" /> : null}
      <div className="stack">
        <div className="row aux">
          <Badge tone={statusTone(d.draft.status)}>{draftStatusLabel(d.draft.status)}</Badge>
          <span>宛先: {RECIPIENT_TYPE_LABEL[d.draft.recipientType]}{d.currentRevision?.snapshot.recipient.nameRaw ? ` ／ ${d.currentRevision.snapshot.recipient.nameRaw}` : ''}</span>
          <span>書式: {d.templateVersion.templateName} v{d.templateVersion.revision}</span>
          {d.templateVersion.sampleOnly ? <SampleOnlyBadge /> : null}
          {report ? <span>検査 {formatDateTime(report.generatedAt)}</span> : null}
          <Button small variant="quiet" icon="refresh" onClick={() => void preflight.refetch()}>検査をやり直す</Button>
        </div>
        {d.templateVersion.sampleOnly ? <Alert kind="warning" title="サンプル書式です">正式出力はできません。所内書式版として承認された書式で作成し直すか、草案としてのみ利用してください。</Alert> : null}
        {d.openReviewId ? (
          <Alert kind="info" title="レビュー依頼中です" actions={<LinkButton to={`/reviews/${d.openReviewId}`} small>レビューを開く</LinkButton>}>
            依頼済みのレビューがあります。
          </Alert>
        ) : null}
        {submitErr ? <Alert kind="error" live>{submitErr}</Alert> : null}

        <div className="grid-12">
          <div className="col-5 stack">
            <section className="band" aria-labelledby="h-errors">
              <h2 id="h-errors" style={{ fontSize: 18, marginBottom: 'var(--space-3)' }}>
                <Icon name="alert" size={20} label="停止エラー" /> 停止エラー <span className="aux muted num">{errors.length} 件</span>
              </h2>
              {errors.length === 0 ? <p className="muted">正式出力を止めるエラーはありません。</p> : <ul className="rowlist">{errors.map((i, k) => <PreflightIssueRow key={`${i.code}-${k}`} issue={i} draftId={id} />)}</ul>}
            </section>
            <section className="band" aria-labelledby="h-confirms">
              <h2 id="h-confirms" style={{ fontSize: 18, marginBottom: 'var(--space-3)' }}>
                <Icon name="review" size={20} label="要確認" /> 要確認（理由を記録） <span className="aux muted num">{confirms.length} 件</span>
              </h2>
              {confirms.length === 0 ? <p className="muted">理由付き確認が必要な項目はありません。</p> : null}
              <ul className="stack">
                {confirms.map((c, k) => (
                  <li key={`${c.code}-${k}`} className="stack-s">
                    <div>
                      <b>{c.message}</b> <span className="aux muted mono">{c.code}</span>
                      {c.fieldKey || c.blockId ? <> <Link to={c.fieldKey ? `/drafts/${id}/edit?focus=${c.fieldKey}` : `/drafts/${id}/edit?block=${c.blockId}`} className="aux">該当箇所へ</Link></> : null}
                    </div>
                    <Field label="確認した理由" required>
                      {({ id: fid, describedBy }) => <TextArea id={fid} short value={reasons[c.code] ?? ''} onValueChange={(v) => setReasons((r) => ({ ...r, [c.code]: v }))} aria-describedby={describedBy} />}
                    </Field>
                  </li>
                ))}
              </ul>
            </section>
            <section className="band" aria-labelledby="h-warnings">
              <h2 id="h-warnings" style={{ fontSize: 18, marginBottom: 'var(--space-3)' }}>
                <Icon name="info" size={20} label="警告" /> 警告 <span className="aux muted num">{warnings.length} 件</span>
              </h2>
              {warnings.length === 0 ? <p className="muted">警告はありません。</p> : <ul className="rowlist">{warnings.map((i, k) => <PreflightIssueRow key={`${i.code}-${k}`} issue={i} draftId={id} />)}</ul>}
            </section>
            <LegalReviewNote report={report} />
            <section className="band stack" aria-labelledby="h-request">
              <h2 id="h-request" style={{ fontSize: 18 }}>レビュー依頼</h2>
              <Field label="確認する弁護士" required hint="最終編集者とは別の弁護士が確認します。自己承認はできません。">
                {({ id: fid, describedBy }) => <Select id={fid} value={reviewerId} onValueChange={setReviewerId} options={reviewerOptions} placeholder="選択してください" aria-describedby={describedBy} />}
              </Field>
              {reviewers.length < 2 ? <Alert kind="warning">弁護士が 2 名未満です。運用は弁護士 2 名以上を前提としています（設定画面で確認）。</Alert> : null}
              <Field label="依頼メモ（任意）">
                {({ id: fid }) => <TextArea id={fid} short value={note} onValueChange={setNote} />}
              </Field>
              <div>
                <Button variant="primary" icon="review" onClick={() => void submit()} busy={busy} disabledReason={blockReason}>
                  レビューを依頼
                </Button>
              </div>
            </section>
          </div>
          <div className="col-7 stack">
            <div className="row-between">
              <b><Icon name="document" size={20} /> 最終プレビュー（草案 PDF）</b>
              <Button small icon="refresh" onClick={() => void regenerate()} busy={!!renderJobId && renderJob.data?.state !== 'failed'}>
                プレビューを更新
              </Button>
            </div>
            {renderJobId ? <JobProgress job={renderJob.data} pendingLabel="PDF を生成しています…" compact onRetry={() => void regenerate()} /> : null}
            {!pdf ? <Alert kind="warning">現在の版（{d.currentRevision?.revision ?? '—'}）の PDF がありません。「プレビューを更新」で生成してください。レビューでは PDF の hash が承認対象になります。</Alert> : null}
            <PdfPreview src={pdf ? outputDownloadUrl(pdf.id, 'draft') : null} version={pdf?.id} />
          </div>
        </div>
      </div>
    </div>
  );
}
