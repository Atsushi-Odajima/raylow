/**
 * S09 /documents/:id/output: 版/承認者/宛先 → 草案 DOCX 取得 と 正式 DOCX/PDF 取得（別） → 送付記録。
 * ダウンロードは送付/提出済みにしない（明示）。
 */
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import type { DraftOutput } from '@raylow/contracts';
import { draftKeys, renderDraft, useDocumentOutput } from '../api/drafts';
import { useJob } from '../api/jobs';
import { isApiError } from '../lib/apiClient';
import { downloadFile, outputDownloadUrl } from '../lib/download';
import { formatDateTime, shortHash } from '../lib/format';
import { DISPATCH_METHOD_LABEL, DISPATCH_STATUS_LABEL, RECIPIENT_TYPE_LABEL, draftStatusLabel, label } from '../lib/labels';
import { Alert } from '../components/Alert';
import { Badge, statusTone } from '../components/Badge';
import { Button, LinkButton } from '../components/Button';
import { JobProgress } from '../components/JobProgress';
import { PageHeader } from '../components/PageHeader';
import { PdfPreview } from '../components/PdfPreview';
import { ErrorState, LoadingState } from '../components/States';
import { Icon } from '../components/Icon';

function pick(outputs: DraftOutput[], format: 'docx' | 'pdf', mode: 'draft' | 'final', revisionId?: string | null): DraftOutput | null {
  const list = outputs.filter((o) => o.format === format && o.mode === mode && o.status === 'ready' && (!revisionId || o.revisionId === revisionId)).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return list[0] ?? null;
}

export function DocumentOutputPage() {
  const { id } = useParams();
  const qc = useQueryClient();
  const q = useDocumentOutput(id);
  const [msg, setMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const job = useJob(jobId);
  useEffect(() => {
    if (job.data && jobId && (job.data.state === 'succeeded' || job.data.state === 'failed')) {
      void qc.invalidateQueries({ queryKey: draftKeys.output(id ?? '') });
      if (job.data.state === 'succeeded') setJobId(null);
    }
  }, [job.data, jobId, id, qc]);

  const d = q.data;
  const approvedId = d?.approvedRevision?.id ?? null;
  const finalDocx = useMemo(() => (d ? pick(d.outputs, 'docx', 'final', approvedId) : null), [d, approvedId]);
  const finalPdf = useMemo(() => (d ? pick(d.outputs, 'pdf', 'final', approvedId) : null), [d, approvedId]);
  const draftDocx = useMemo(() => (d ? pick([...d.draftOutputs, ...d.outputs], 'docx', 'draft', d.draft.currentRevisionId) : null), [d]);
  const draftPdf = useMemo(() => (d ? pick([...d.draftOutputs, ...d.outputs], 'pdf', 'draft', d.draft.currentRevisionId) : null), [d]);

  const dl = async (o: DraftOutput, mode: 'draft' | 'final', name: string) => {
    setMsg(null);
    try {
      const fn = await downloadFile(outputDownloadUrl(o.id, mode), name);
      setMsg({ kind: 'success', text: `${fn} を取得しました。ダウンロードしただけでは送付・提出済みにはなりません。送付したら「送付・提出を記録」してください。` });
    } catch (e) {
      setMsg({ kind: 'error', text: isApiError(e) ? (e.code === 'hash_stale' || e.isConflict ? '承認済み版の hash と一致しないため正式版を取得できません。再生成・再レビューが必要です。' : e.userMessage()) : '取得に失敗しました' });
    }
  };
  const renderFinal = async () => {
    if (!id) return;
    setMsg(null);
    try {
      const r = await renderDraft(id, 'final');
      setJobId(r.jobId);
    } catch (e) {
      setMsg({ kind: 'error', text: isApiError(e) ? e.userMessage() : '正式版の生成を開始できませんでした' });
    }
  };

  if (q.isLoading) return <div className="container"><LoadingState /></div>;
  if (q.isError || !d || !id) return <div className="container" style={{ paddingTop: 'var(--space-6)' }}><ErrorState error={q.error ?? new Error('not found')} onRetry={() => void q.refetch()} /></div>;

  const approved = !!d.approvedRevision && d.draft.status === 'approved';
  const rec = d.approvedRevision?.snapshot.recipient;
  const title = d.draft.titleRaw.replace(/[\\/:*?"<>|]/g, '_');

  return (
    <div className="container">
      <PageHeader
        title="承認版の取得"
        lead={`${d.draft.titleRaw} ／ ${d.draft.matterTitleRaw}`}
        crumbs={[{ to: '/documents', label: '書類' }, { label: '出力' }]}
        actions={
          <>
            <LinkButton to={`/drafts/${id}/edit`} icon="portal">編集画面</LinkButton>
            <LinkButton to={`/dispatches/new?matterId=${d.draft.matterId}${finalPdf ? `&outputId=${finalPdf.id}` : ''}`} variant="primary" icon="recipient">
              送付・提出を記録
            </LinkButton>
          </>
        }
      />
      <div className="stack">
        <section className="band">
          <dl className="dl">
            <dt>状態</dt>
            <dd><Badge tone={statusTone(d.draft.status)}>{draftStatusLabel(d.draft.status)}</Badge></dd>
            <dt>承認版</dt>
            <dd>{d.approvedRevision ? <>revision {d.approvedRevision.revision} ／ hash {shortHash(d.approvedRevision.hash)} ／ {formatDateTime(d.approvedRevision.createdAt)}</> : <span className="muted">承認済みの版はありません</span>}</dd>
            <dt>宛先</dt>
            <dd>{rec ? `${RECIPIENT_TYPE_LABEL[rec.type]} ／ ${rec.nameRaw}${rec.organizationNameRaw ? `（${rec.organizationNameRaw}）` : ''}` : RECIPIENT_TYPE_LABEL[d.draft.recipientType]}</dd>
            <dt>現在の版</dt>
            <dd className="num">{d.draft.currentRevisionId ? d.draft.currentRevisionId.slice(0, 8) : '—'}{d.approvedRevision && d.draft.currentRevisionId !== d.approvedRevision.id ? <Badge tone="warning">承認後に編集された版があります</Badge> : null}</dd>
          </dl>
        </section>
        {msg ? <Alert kind={msg.kind} live>{msg.text}</Alert> : null}
        {jobId ? <JobProgress job={job.data} pendingLabel="正式版を生成しています…" onRetry={() => void renderFinal()} /> : null}

        <div className="grid-12">
          <section className="col-6 band stack" aria-labelledby="h-draft">
            <h2 id="h-draft" style={{ fontSize: 18 }}><Icon name="document" size={20} /> 草案の取得（草案表記あり）</h2>
            <p className="aux muted">現在の版から生成された草案です。Word で追編集した場合は編集画面から外部編集版として再取込します。</p>
            <div className="row">
              <Button icon="export" onClick={() => draftDocx && void dl(draftDocx, 'draft', `${title}_草案.docx`)} disabledReason={!draftDocx ? '現在の版の草案 DOCX がありません。編集画面で「プレビューを更新」してください' : undefined}>
                草案 DOCX を取得
              </Button>
              <Button icon="export" onClick={() => draftPdf && void dl(draftPdf, 'draft', `${title}_草案.pdf`)} disabledReason={!draftPdf ? '現在の版の草案 PDF がありません' : undefined}>
                草案 PDF を取得
              </Button>
            </div>
            {!approved ? (
              <Alert kind="info" title="正式出力には弁護士の承認が必要です" actions={<LinkButton to={`/drafts/${id}/check`} small variant="primary">形式検査・レビュー依頼へ</LinkButton>}>
                草案の取得とレビューは別の操作です。承認後にこの画面で正式 DOCX/PDF を取得できます。
              </Alert>
            ) : null}
          </section>
          <section className="col-6 band stack" aria-labelledby="h-final">
            <h2 id="h-final" style={{ fontSize: 18 }}><Icon name="output" size={20} /> 正式 DOCX / PDF の取得</h2>
            <p className="aux muted">承認済み revision の hash と一致する場合のみ取得できます。承認後に編集された版は正式版になりません。</p>
            <div className="row">
              <Button variant="primary" icon="export" onClick={() => finalDocx && void dl(finalDocx, 'final', `${title}.docx`)} disabledReason={!approved ? '承認済みの版がありません' : !finalDocx ? '正式 DOCX が未生成です。「正式版を生成」してください' : undefined}>
                正式 DOCX を取得
              </Button>
              <Button variant="primary" icon="export" onClick={() => finalPdf && void dl(finalPdf, 'final', `${title}.pdf`)} disabledReason={!approved ? '承認済みの版がありません' : !finalPdf ? '正式 PDF が未生成です。「正式版を生成」してください' : undefined}>
                正式 PDF を取得
              </Button>
              {approved && (!finalDocx || !finalPdf) ? (
                <Button icon="refresh" onClick={() => void renderFinal()} busy={!!jobId && job.data?.state !== 'failed'}>
                  正式版を生成
                </Button>
              ) : null}
            </div>
            {finalPdf ? <div className="aux muted">PDF sha256 {shortHash(finalPdf.sha256)} ／ renderer {finalPdf.rendererVersion} ／ {formatDateTime(finalPdf.createdAt)}</div> : null}
          </section>
        </div>

        {finalPdf || draftPdf ? (
          <section className="stack-s">
            <h2 style={{ fontSize: 18 }}>{finalPdf ? '正式 PDF' : '草案 PDF'} プレビュー</h2>
            <PdfPreview src={finalPdf ? outputDownloadUrl(finalPdf.id, 'final') : draftPdf ? outputDownloadUrl(draftPdf.id, 'draft') : null} version={(finalPdf ?? draftPdf)?.id} />
          </section>
        ) : null}

        <section className="band stack" aria-labelledby="h-dispatch">
          <h2 id="h-dispatch" style={{ fontSize: 18 }}><Icon name="recipient" size={20} /> 送付・提出記録</h2>
          <Alert kind="info">出力（ダウンロード）と送付・提出は別の状態です。実際に送付・提出したら手動で記録し、別の担当者が受領を確認します。アプリは外部へ自動送信しません。</Alert>
          {d.dispatches.length === 0 ? <p className="muted">送付・提出記録はありません。</p> : (
            <ul className="rowlist">
              {d.dispatches.map((r) => (
                <li key={r.id} className="rowlist__item">
                  <div className="rowlist__main">
                    <div className="rowlist__title"><Link to={`/dispatches/${r.id}`}>{label(DISPATCH_METHOD_LABEL, r.method)} → {r.recipientSnapshot.nameRaw}</Link></div>
                    <div className="rowlist__meta">
                      <Badge tone={statusTone(r.status)}>{label(DISPATCH_STATUS_LABEL, r.status)}</Badge>
                      <time dateTime={r.sentAt}>{formatDateTime(r.sentAt)}</time>
                      <span>記録: {r.recordedByName ?? '—'}</span>
                      {r.verifiedByName ? <span>確認: {r.verifiedByName}</span> : null}
                      {r.outputLabel ? <span>{r.outputLabel}</span> : null}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
