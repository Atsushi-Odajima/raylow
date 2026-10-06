/** S13 /batches/:id: 成果物一覧 → エラー → 失敗分のみ再試行。「3/8 書類を作成中」 */
import { Link, useParams } from 'react-router';
import { useBatch, useCancelBatch, useRetryBatchItem } from '../api/batches';
import { formatDateTime } from '../lib/format';
import { BATCH_STATUS_LABEL, JOB_STATE_LABEL, RECIPIENT_TYPE_LABEL, label } from '../lib/labels';
import { Alert } from '../components/Alert';
import { Badge, statusTone } from '../components/Badge';
import { Button, LinkButton } from '../components/Button';
import { Icon } from '../components/Icon';
import { PageHeader } from '../components/PageHeader';
import { ErrorState, LoadingState } from '../components/States';

export function BatchDetailPage() {
  const { id } = useParams();
  const q = useBatch(id);
  const cancel = useCancelBatch();
  const retry = useRetryBatchItem();
  const batch = q.data;
  if (q.isLoading) return <div className="container"><LoadingState /></div>;
  if (q.isError || !batch || !id) return <div className="container" style={{ paddingTop: 'var(--space-6)' }}><ErrorState error={q.error ?? new Error('not found')} onRetry={() => void q.refetch()} /></div>;
  const done = batch.counts.succeeded + batch.counts.failed;
  return (
    <div className="container">
      <PageHeader
        title="一括作成の結果"
        lead={`${batch.purpose === 'submission_pack' ? '正式提出パック用' : '草案'} ／ 作成 ${formatDateTime(batch.createdAt)}`}
        crumbs={[{ to: '/create', label: '作成' }, { label: '一括作成' }]}
        actions={<><LinkButton to={`/matters/${batch.matterId}`} icon="case">案件</LinkButton>{batch.status === 'queued' || batch.status === 'running' ? <Button variant="danger" onClick={() => cancel.mutate(batch.id)} busy={cancel.isPending}>中止（未開始分のみ）</Button> : null}</>}
      />
      <div className="stack">
        <div className="job-progress" role="status" aria-live="polite">
          <div className="row-between">
            <span><Icon name={batch.status === 'succeeded' ? 'check' : batch.status === 'running' || batch.status === 'queued' ? 'spinner' : 'alert'} size={20} label={label(BATCH_STATUS_LABEL, batch.status)} /> <b className="job-progress__count">{done}/{batch.counts.total}</b> 書類を{batch.status === 'running' || batch.status === 'queued' ? '作成中' : '処理済み'}（成功 {batch.counts.succeeded} ／ 失敗 {batch.counts.failed} ／ 待機 {batch.counts.queued} ／ 処理中 {batch.counts.running}）</span>
            <Badge tone={statusTone(batch.status)}>{label(BATCH_STATUS_LABEL, batch.status)}</Badge>
          </div>
          <div className="job-progress__bar" role="progressbar" aria-valuemin={0} aria-valuemax={batch.counts.total} aria-valuenow={done}><span style={{ width: `${batch.counts.total ? Math.round((done / batch.counts.total) * 100) : 0}%` }} /></div>
        </div>
        {batch.status === 'partial_failed' ? <Alert kind="warning" title="一部が失敗しました">失敗した書類だけ再試行できます。{batch.purpose === 'submission_pack' ? '正式提出パックは全件完成が必要なため、欠落があると出力できません。' : '草案は成功分を個別に取得できます。'}</Alert> : null}
        <Alert kind="info">各書類は宛先ごとに独立した snapshot から生成されています。他の宛先の情報が混入していないか、宛名・住所を確認してください。</Alert>
        <div className="table-wrap">
          <table className="table">
            <caption className="sr-only">一括作成の成果物</caption>
            <thead><tr><th scope="col">書式</th><th scope="col">宛先</th><th scope="col">状態</th><th scope="col">エラー</th><th scope="col">試行</th><th scope="col">操作</th></tr></thead>
            <tbody>
              {batch.items.map((it) => {
                const rs = it.recipientSnapshot as { type?: string; nameRaw?: string; organizationNameRaw?: string };
                return (
                  <tr key={it.id}>
                    <td>{it.templateName}</td>
                    <td>{rs.type ? label(RECIPIENT_TYPE_LABEL, rs.type) : ''}{rs.nameRaw ? ` ／ ${rs.nameRaw}` : ''}{rs.organizationNameRaw ? <div className="aux muted">{rs.organizationNameRaw}</div> : null}</td>
                    <td><Badge tone={statusTone(it.status)}>{label(JOB_STATE_LABEL, it.status)}</Badge></td>
                    <td>{it.errorMessage ?? it.errorCode ?? ''}</td>
                    <td className="num">{it.attempt}</td>
                    <td className="actions">
                      {it.draftId ? <Link to={`/drafts/${it.draftId}/edit`} className="btn btn-small">開く</Link> : null}{' '}
                      {it.status === 'failed' ? <Button small icon="refresh" onClick={() => retry.mutate({ itemId: it.id, batchId: batch.id })} busy={retry.isPending}>再試行</Button> : null}{' '}
                      {it.jobId ? <Link to={`/jobs/${it.jobId}`} className="aux">ジョブ</Link> : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
