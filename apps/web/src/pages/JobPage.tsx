import { Link, useParams } from 'react-router';
import { useCancelJob, useJob } from '../api/jobs';
import { JobProgress } from '../components/JobProgress';
import { PageHeader } from '../components/PageHeader';
import { ErrorState, LoadingState } from '../components/States';
import { LinkButton } from '../components/Button';
import { Alert } from '../components/Alert';
import { formatDateTime } from '../lib/format';
import { JOB_STATE_LABEL, JOB_TYPE_LABEL, label } from '../lib/labels';

/** S19 /jobs/:id: 結果/件数 → 失敗理由 → 再試行・成果物 */
export function JobPage() {
  const { id } = useParams();
  const job = useJob(id);
  const cancel = useCancelJob();
  const j = job.data;
  const result = (j?.result ?? {}) as Record<string, unknown>;
  const str = (k: string): string | null => (typeof result[k] === 'string' ? (result[k] as string) : null);
  const draftId = str('draftId');
  const batchId = str('batchId');
  const packetId = str('packetId');
  const outputFileId = str('outputFileId');
  const templateVersionId = str('templateVersionId');
  const templateId = str('templateId');

  return (
    <div className="container">
      <PageHeader title="ジョブの進捗" crumbs={[{ to: '/create', label: '作成' }, { label: 'ジョブ' }]} lead={j ? `${label(JOB_TYPE_LABEL, j.type)} ／ ${label(JOB_STATE_LABEL, j.state)}` : undefined} />
      {job.isLoading ? <LoadingState /> : null}
      {job.isError ? <ErrorState error={job.error} onRetry={() => void job.refetch()} /> : null}
      {j ? (
        <div className="stack">
          <JobProgress job={j} onCancel={() => cancel.mutate(j.id)} />
          {j.state === 'cancelled' ? <Alert kind="info">中止しました。未開始の子ジョブだけ停止し、処理中のものは安全な地点で停止します。</Alert> : null}
          {j.state === 'succeeded' ? (
            <Alert
              kind="success"
              title="完了しました"
              actions={
                <>
                  {draftId ? <LinkButton to={`/drafts/${draftId}/edit`} small variant="primary">草案を開く</LinkButton> : null}
                  {batchId ? <LinkButton to={`/batches/${batchId}`} small variant="primary">一括作成の結果を開く</LinkButton> : null}
                  {packetId ? <LinkButton to={`/packets/${packetId}`} small variant="primary">提出パックを開く</LinkButton> : null}
                  {templateId && templateVersionId ? <LinkButton to={`/templates/import?versionId=${templateVersionId}`} small variant="primary">書式の検査結果を開く</LinkButton> : null}
                  {j.matterId && !draftId && !batchId && !packetId ? <LinkButton to={`/matters/${j.matterId}`} small>案件を開く</LinkButton> : null}
                </>
              }
            >
              {outputFileId ? <span className="mono aux">出力ファイル: {outputFileId}</span> : '成果物は各画面から取得できます。'}
            </Alert>
          ) : null}
          <section className="band">
            <h2 style={{ marginBottom: 'var(--space-3)' }}>詳細</h2>
            <dl className="dl">
              <dt>ジョブ ID</dt>
              <dd className="mono">{j.id}</dd>
              <dt>種類</dt>
              <dd>{label(JOB_TYPE_LABEL, j.type)}</dd>
              <dt>状態</dt>
              <dd>{label(JOB_STATE_LABEL, j.state)}</dd>
              <dt>試行</dt>
              <dd className="num">
                {j.attempt} / {j.maxAttempts}
              </dd>
              <dt>作成</dt>
              <dd>{formatDateTime(j.createdAt)}</dd>
              <dt>更新</dt>
              <dd>{formatDateTime(j.updatedAt)}</dd>
              {j.errorCode ? (
                <>
                  <dt>エラーコード</dt>
                  <dd className="mono">{j.errorCode}</dd>
                </>
              ) : null}
              {j.matterId ? (
                <>
                  <dt>案件</dt>
                  <dd>
                    <Link to={`/matters/${j.matterId}`}>案件を開く</Link>
                  </dd>
                </>
              ) : null}
            </dl>
          </section>
        </div>
      ) : null}
    </div>
  );
}
