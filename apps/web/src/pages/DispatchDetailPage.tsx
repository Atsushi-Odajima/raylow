/** S18 /dispatches/:id: 記録の表示と他担当者による受領確認 */
import { useParams } from 'react-router';
import { useDispatchRecord, useVerifyDispatch } from '../api/packets';
import { isApiError } from '../lib/apiClient';
import { fileContentUrl, openInNewTab } from '../lib/download';
import { formatDateTime } from '../lib/format';
import { DISPATCH_METHOD_LABEL, DISPATCH_STATUS_LABEL, label } from '../lib/labels';
import { useSession } from '../lib/session';
import { Alert } from '../components/Alert';
import { Badge, statusTone } from '../components/Badge';
import { Button, LinkButton } from '../components/Button';
import { PageHeader } from '../components/PageHeader';
import { ErrorState, LoadingState } from '../components/States';

export function DispatchDetailPage() {
  const { id } = useParams();
  const session = useSession();
  const q = useDispatchRecord(id);
  const verify = useVerifyDispatch();
  if (q.isLoading) return <div className="container"><LoadingState /></div>;
  if (q.isError || !q.data) return <div className="container" style={{ paddingTop: 'var(--space-6)' }}><ErrorState error={q.error ?? new Error('not found')} onRetry={() => void q.refetch()} /></div>;
  const r = q.data;
  const me = session.info?.user?.id;
  const verifyBlock = r.status === 'received_verified' ? '既に受領確認済みです' : r.recordedBy === me ? '記録者本人は確認できません（別の担当者が確認します）' : undefined;
  return (
    <div className="container">
      <PageHeader title="送付・提出記録" lead={`${label(DISPATCH_METHOD_LABEL, r.method)} → ${r.recipientSnapshot.nameRaw}`} crumbs={[{ to: `/matters/${r.matterId}`, label: '案件' }, { label: '送付・提出記録' }]} actions={<><LinkButton to={`/matters/${r.matterId}`} icon="case">案件</LinkButton><Button variant="primary" icon="check" busy={verify.isPending} disabledReason={verifyBlock} onClick={() => verify.mutate({ id: r.id, expectedVersion: r.version })}>受領を確認（別担当者）</Button></>} />
      <div className="stack">
        <div className="row aux"><Badge tone={statusTone(r.status)}>{label(DISPATCH_STATUS_LABEL, r.status)}</Badge><span>記録 {r.recordedByName ?? '—'} ／ {formatDateTime(r.createdAt)}</span>{r.verifiedByName ? <span>確認 {r.verifiedByName} ／ {formatDateTime(r.verifiedAt)}</span> : null}</div>
        {verify.isError ? <Alert kind="error" live>{isApiError(verify.error) ? verify.error.userMessage() : '確認に失敗しました'}</Alert> : null}
        <Alert kind="info">出力済み（ダウンロード）と提出済みは別の状態です。この記録は手動登録であり、アプリが送信したことを意味しません。</Alert>
        <section className="band">
          <h2 style={{ fontSize: 18, marginBottom: 'var(--space-3)' }}>出した版</h2>
          <dl className="dl"><dt>出力</dt><dd>{r.outputLabel ?? (r.outputId ? <span className="mono">{r.outputId}</span> : '—')}</dd><dt>提出パック</dt><dd>{r.packetId ? <a href={`/packets/${r.packetId}`}>{r.packetId.slice(0, 8)}</a> : '—'}</dd></dl>
        </section>
        <section className="band">
          <h2 style={{ fontSize: 18, marginBottom: 'var(--space-3)' }}>宛先・方法・日時</h2>
          <dl className="dl"><dt>宛先</dt><dd>{r.recipientSnapshot.nameRaw}{r.recipientSnapshot.organizationNameRaw ? `（${r.recipientSnapshot.organizationNameRaw}）` : ''}<div className="aux muted">{r.recipientSnapshot.addressRaw}</div></dd><dt>方法</dt><dd>{label(DISPATCH_METHOD_LABEL, r.method)}{r.methodNoteRaw ? ` ／ ${r.methodNoteRaw}` : ''}</dd><dt>日時</dt><dd>{formatDateTime(r.sentAt)}</dd></dl>
        </section>
        <section className="band">
          <h2 style={{ fontSize: 18, marginBottom: 'var(--space-3)' }}>受付情報</h2>
          <dl className="dl"><dt>受付番号（原文）</dt><dd>{r.receiptRaw || '—'}</dd><dt>受領資料</dt><dd>{r.receivedDocumentsRaw || '—'}</dd><dt>控えファイル</dt><dd>{r.receiptFileId ? <Button small icon="original" onClick={() => void openInNewTab(fileContentUrl(r.receiptFileId ?? ''))}>控えを開く</Button> : '—'}</dd></dl>
        </section>
      </div>
    </div>
  );
}
