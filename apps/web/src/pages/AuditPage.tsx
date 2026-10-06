/** S20 /audit: 監査ログ一覧。未権限の本文は出さない（details の本文系キーを表示しない） */
import { useState } from 'react';
import { useAudit } from '../api/misc';
import { formatDateTime, shortHash } from '../lib/format';
import { Button } from '../components/Button';
import { Field } from '../components/Field';
import { Input } from '../components/Input';
import { PageHeader } from '../components/PageHeader';
import { EmptyState, ErrorState, LoadingState } from '../components/States';

const HIDDEN_KEY = /body|text|ast|snapshot|content|secret|token|password/i;

function summarizeDetails(d: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(d)) {
    if (HIDDEN_KEY.test(k)) continue;
    if (v == null) continue;
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') parts.push(`${k}=${String(v).slice(0, 60)}`);
  }
  return parts.join(' ／ ');
}

export function AuditPage() {
  const [matterId, setMatterId] = useState('');
  const [action, setAction] = useState('');
  const list = useAudit({ matterId: matterId.trim() || undefined, action: action.trim() || undefined });
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <div className="container">
      <PageHeader title="監査ログ" lead="append-only。actor・action・対象の版・hash・requestId・日時を記録します。本文・token・secret は記録も表示もしません。運用者の特権アクセスも記録されます。" crumbs={[{ to: '/settings', label: '設定' }, { label: '監査' }]} />
      <div className="stack">
        <div className="form-grid">
          <Field label="案件 ID で絞り込み">{({ id }) => <Input id={id} value={matterId} onValueChange={setMatterId} autoComplete="off" className="mono" />}</Field>
          <Field label="action で絞り込み">{({ id }) => <Input id={id} value={action} onValueChange={setAction} autoComplete="off" placeholder="例: draft.approve" />}</Field>
        </div>
        {list.isLoading ? <LoadingState /> : null}
        {list.isError ? <ErrorState error={list.error} onRetry={() => void list.refetch()} /> : null}
        {list.isSuccess && items.length === 0 ? <EmptyState title="該当する監査イベントがありません" /> : null}
        {items.length > 0 ? (
          <div className="table-wrap">
            <table className="table">
              <caption className="sr-only">監査イベント</caption>
              <thead><tr><th scope="col">日時</th><th scope="col">actor</th><th scope="col">action</th><th scope="col">対象</th><th scope="col">版 / hash</th><th scope="col">requestId</th><th scope="col">詳細（本文を除く）</th></tr></thead>
              <tbody>
                {items.map((e) => (
                  <tr key={e.id}>
                    <td><time dateTime={e.createdAt}>{formatDateTime(e.createdAt)}</time></td>
                    <td>{e.actorName ?? '—'}{e.actorRole ? <span className="aux muted">（{e.actorRole}）</span> : null}</td>
                    <td className="mono">{e.action}</td>
                    <td className="mono aux">{e.targetType} {e.targetId?.slice(0, 8) ?? ''}</td>
                    <td className="mono aux num">{e.targetVersion ?? '—'} / {shortHash(e.targetHash)}</td>
                    <td className="mono aux">{e.requestId ?? '—'}</td>
                    <td className="aux">{summarizeDetails(e.details)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        {list.hasNextPage ? <div><Button onClick={() => void list.fetchNextPage()} busy={list.isFetchingNextPage}>さらに読み込む</Button></div> : null}
      </div>
    </div>
  );
}
