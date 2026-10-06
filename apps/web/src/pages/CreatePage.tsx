import { Link } from 'react-router';
import { useCreateHome } from '../api/home';
import { Alert } from '../components/Alert';
import { Badge, SampleOnlyBadge, statusTone } from '../components/Badge';
import { LinkButton } from '../components/Button';
import { Icon } from '../components/Icon';
import { EmptyState, ErrorState, LoadingState } from '../components/States';
import { formatDateTime } from '../lib/format';
import { draftStatusLabel, templateKindLabel } from '../lib/labels';

/** S01 /create: 「書類を作る」→ よく使う書式 → 最近の下書き → 確認待ち */
export function CreatePage() {
  const home = useCreateHome();
  return (
    <div className="container">
      <section className="home-hero">
        <div className="stack">
          <h1 className="h-ja home-hero__title">書類を作る</h1>
          <p className="muted">案件と書式と宛先を選ぶと、登録済みの事務所・案件・宛先の情報を差し込んだ草案を作成します。登録済みの情報は再入力しません。</p>
        </div>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <LinkButton to="/drafts/new" variant="primary" icon="create">
            新しい書類を作る
          </LinkButton>
          <LinkButton to="/batches/new" icon="merge">
            一括作成
          </LinkButton>
        </div>
      </section>

      {home.isLoading ? <LoadingState /> : null}
      {home.isError ? <ErrorState error={home.error} onRetry={() => void home.refetch()} /> : null}
      {home.data ? (
        <>
          {home.data.needsSetup ? (
            <Alert
              kind="warning"
              title="初期設定が必要です"
              actions={
                <LinkButton to="/setup" variant="primary" small>
                  初期設定へ
                </LinkButton>
              }
            >
              差出人となる事務所情報（名称・住所・連絡先）と所属弁護士が未登録です。書類作成の前に登録してください。
            </Alert>
          ) : null}
          <div className="home-bands" style={{ marginTop: 'var(--space-5)' }}>
            <section className="band" aria-labelledby="h-templates">
              <div className="band__title">
                <Icon name="template" size={20} />
                <h2 id="h-templates">よく使う書式</h2>
              </div>
              {home.data.frequentTemplates.length === 0 ? (
                <EmptyState title="まだ書式の利用実績がありません" action={<LinkButton to="/templates">書式一覧を見る</LinkButton>}>
                  書式一覧から選んで作成を始めてください。
                </EmptyState>
              ) : (
                <ul className="rowlist">
                  {home.data.frequentTemplates.map((t) => (
                    <li key={t.versionId} className="rowlist__item">
                      <div className="rowlist__main">
                        <div className="rowlist__title">{t.name}</div>
                        <div className="rowlist__meta">
                          <span>{templateKindLabel(t.kind)}</span>
                          <Badge tone={statusTone(t.status)}>{t.status === 'published' ? '公開' : t.status}</Badge>
                          {t.sampleOnly ? <SampleOnlyBadge /> : null}
                        </div>
                      </div>
                      <div className="rowlist__actions">
                        <LinkButton to={`/drafts/new?templateVersionId=${t.versionId}`} small variant="primary">
                          この書式で作成
                        </LinkButton>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <div className="home-bands__side">
              <section className="band" aria-labelledby="h-recent">
                <div className="band__title">
                  <Icon name="document" size={20} />
                  <h2 id="h-recent">最近の下書き</h2>
                </div>
                {home.data.recentDrafts.length === 0 ? (
                  <EmptyState title="下書きはありません" action={<LinkButton to="/drafts/new" small variant="primary">新しい書類を作る</LinkButton>} />
                ) : (
                  <ul className="rowlist">
                    {home.data.recentDrafts.map((d) => (
                      <li key={d.id} className="rowlist__item">
                        <div className="rowlist__main">
                          <div className="rowlist__title">
                            <Link to={d.status === 'approved' || d.status === 'superseded' ? `/documents/${d.id}/output` : `/drafts/${d.id}/edit`}>{d.titleRaw}</Link>
                          </div>
                          <div className="rowlist__meta">
                            <span>{d.matterTitleRaw}</span>
                            <span>{templateKindLabel(d.kind)}</span>
                            <Badge tone={statusTone(d.status)}>{draftStatusLabel(d.status)}</Badge>
                            <time dateTime={d.updatedAt}>{formatDateTime(d.updatedAt)}</time>
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
                <div style={{ marginTop: 'var(--space-3)' }}>
                  <Link to="/documents">すべての書類</Link>
                </div>
              </section>
              <section className="band" aria-labelledby="h-reviews">
                <div className="band__title">
                  <Icon name="review" size={20} />
                  <h2 id="h-reviews">確認待ち</h2>
                </div>
                {home.data.pendingReviews.length === 0 ? (
                  <p className="muted">確認待ちのレビューはありません。</p>
                ) : (
                  <ul className="rowlist">
                    {home.data.pendingReviews.map((r) => (
                      <li key={r.reviewId} className="rowlist__item">
                        <div className="rowlist__main">
                          <div className="rowlist__title">
                            <Link to={`/reviews/${r.reviewId}`}>{r.titleRaw}</Link>
                          </div>
                          <div className="rowlist__meta">
                            <span>{r.matterTitleRaw}</span>
                            <span>依頼: {r.requestedByName ?? '—'}</span>
                            <time dateTime={r.createdAt}>{formatDateTime(r.createdAt)}</time>
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
                <div style={{ marginTop: 'var(--space-3)' }}>
                  <Link to="/reviews">確認待ち一覧</Link>
                </div>
              </section>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
