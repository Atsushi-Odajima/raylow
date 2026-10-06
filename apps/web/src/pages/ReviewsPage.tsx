/** S07 一覧 /reviews: 確認待ち / 承認 / 差戻し */
import { useState } from 'react';
import { Link } from 'react-router';
import { useReviews } from '../api/reviews';
import { Badge, statusTone } from '../components/Badge';
import { Button } from '../components/Button';
import { Checkbox } from '../components/Checkbox';
import { PageHeader } from '../components/PageHeader';
import { EmptyState, ErrorState, LoadingState } from '../components/States';
import { Tabs } from '../components/Tabs';
import { formatDateTime } from '../lib/format';
import { REVIEW_STATUS_LABEL, label } from '../lib/labels';

type Tab = 'pending' | 'approved' | 'changes_requested';

export function ReviewsPage() {
  const [tab, setTab] = useState<Tab>('pending');
  const [mine, setMine] = useState(true);
  const list = useReviews({ status: tab, mine });
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <div className="container">
      <PageHeader title="確認待ち" lead="担当弁護士が草案の版・宛先・差分・最終 PDF を確認し、承認または理由付きで差し戻します。" crumbs={[{ to: '/create', label: '作成' }, { label: '確認待ち' }]} />
      <div className="stack">
        <Tabs<Tab> label="状態" value={tab} onChange={setTab} items={[{ key: 'pending', label: '確認待ち' }, { key: 'approved', label: '承認済み' }, { key: 'changes_requested', label: '差戻し' }]} />
        <Checkbox checked={mine} onCheckedChange={setMine} label="自分が確認者のものだけ" />
        {list.isLoading ? <LoadingState /> : null}
        {list.isError ? <ErrorState error={list.error} onRetry={() => void list.refetch()} /> : null}
        {list.isSuccess && items.length === 0 ? <EmptyState title={`${label(REVIEW_STATUS_LABEL, tab)}のレビューはありません`}>草案の形式検査（確認へ）からレビューを依頼すると、ここに表示されます。</EmptyState> : null}
        {items.length > 0 ? (
          <ul className="rowlist" aria-label="レビュー一覧">
            {items.map((r) => (
              <li key={r.id} className="rowlist__item">
                <div className="rowlist__main">
                  <div className="rowlist__title">
                    <Link to={`/reviews/${r.id}`}>レビュー {r.id.slice(0, 8)}</Link>
                  </div>
                  <div className="rowlist__meta">
                    <Badge tone={statusTone(r.status)}>{label(REVIEW_STATUS_LABEL, r.status)}</Badge>
                    <span>依頼: {r.requestedByName ?? '—'}</span>
                    <span>確認者: {r.reviewerName ?? '—'}</span>
                    <time dateTime={r.createdAt}>{formatDateTime(r.createdAt)}</time>
                    {r.decidedAt ? <span>決定 {formatDateTime(r.decidedAt)}</span> : null}
                  </div>
                </div>
                <div className="rowlist__actions">
                  <Link to={`/reviews/${r.id}`} className="btn btn-small btn-primary">
                    開く
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        ) : null}
        {list.hasNextPage ? (
          <div>
            <Button onClick={() => void list.fetchNextPage()} busy={list.isFetchingNextPage}>
              さらに読み込む
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
