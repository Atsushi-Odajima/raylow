/**
 * S03 /templates: 種類 → 用途/承認状態 → 適用範囲。PC はカテゴリ横タブ＋行リスト、mobile は検索＋縦一覧。
 * 未公開は正式用に選べない（理由付き disabled）。sample_only は「サンプル・要確認」バッジ。
 */
import { useState, useSyncExternalStore } from 'react';
import { Link, useNavigate } from 'react-router';
import { useTemplates } from '../api/templates';
import { Badge, SampleOnlyBadge, statusTone } from '../components/Badge';
import { Button, LinkButton } from '../components/Button';
import { Input } from '../components/Input';
import { PageHeader } from '../components/PageHeader';
import { Tabs } from '../components/Tabs';
import { EmptyState, ErrorState, LoadingState } from '../components/States';
import { formatDateTime } from '../lib/format';
import { TEMPLATE_SCOPE_LABEL, TEMPLATE_STATUS_LABEL, label, templateKindLabel } from '../lib/labels';
import { sessionStore } from '../lib/session';

type ScopeTab = 'all' | 'negotiation' | 'client' | 'court' | 'internal';

export function TemplatesPage() {
  const [scope, setScope] = useState<ScopeTab>('all');
  const [q, setQ] = useState('');
  const navigate = useNavigate();
  const session = useSyncExternalStore(sessionStore.subscribe.bind(sessionStore), sessionStore.getState.bind(sessionStore), sessionStore.getState.bind(sessionStore));
  const canManage = session.info?.role === 'admin' || session.info?.role === 'lawyer';
  const list = useTemplates({ scope: scope === 'all' ? undefined : scope, q: q.trim() || undefined });

  return (
    <div className="container">
      <PageHeader
        title="書式"
        lead="公開済みの書式だけを正式な書類に使えます。サンプル書式は内容確認後に所内書式版として承認してください。"
        actions={canManage ? <LinkButton to="/templates/import" icon="upload">書式を登録（DOCX）</LinkButton> : undefined}
      />
      <div className="stack">
        <Tabs<ScopeTab>
          label="用途"
          value={scope}
          onChange={setScope}
          items={[
            { key: 'all', label: 'すべて' },
            { key: 'negotiation', label: '交渉' },
            { key: 'client', label: '依頼者' },
            { key: 'court', label: '裁判所' },
            { key: 'internal', label: '所内' },
          ]}
        />
        <div style={{ maxWidth: 480 }}>
          <Input value={q} onValueChange={setQ} placeholder="書式名で検索" aria-label="書式名で検索" autoComplete="off" />
        </div>
        {list.isLoading ? <LoadingState /> : null}
        {list.isError ? <ErrorState error={list.error} onRetry={() => void list.refetch()} /> : null}
        {list.data && list.data.length === 0 ? (
          <EmptyState
            title={q ? '該当する書式がありません' : 'この用途の書式はまだありません'}
            action={
              q ? (
                <Button onClick={() => setQ('')}>検索条件を解除</Button>
              ) : canManage ? (
                <LinkButton to="/templates/import" variant="primary">
                  書式を登録
                </LinkButton>
              ) : undefined
            }
          >
            {canManage ? '自事務所の Word 書式（DOCX）を登録すると、ここに表示されます。' : '管理者または弁護士に書式の登録を依頼してください。'}
          </EmptyState>
        ) : null}
        {list.data && list.data.length > 0 ? (
          <ul className="rowlist" aria-label="書式一覧">
            {list.data.map((t) => {
              const av = t.activeVersion;
              const published = av?.status === 'published';
              const reason = !av ? '版がありません' : !published ? `未公開（${label(TEMPLATE_STATUS_LABEL, av.status)}）の書式は正式な書類に選べません` : undefined;
              return (
                <li key={t.id} className="rowlist__item">
                  <div className="rowlist__main">
                    <div className="rowlist__title">{t.name}</div>
                    <div className="rowlist__meta">
                      <span>{templateKindLabel(t.kind)}</span>
                      {av ? <span>{label(TEMPLATE_SCOPE_LABEL, av.scope)}</span> : null}
                      <Badge tone={statusTone(av?.status ?? '')}>{av ? label(TEMPLATE_STATUS_LABEL, av.status) : '版なし'}</Badge>
                      {av?.sampleOnly ? <SampleOnlyBadge /> : null}
                      {av?.approvedAt ? <span>承認 {formatDateTime(av.approvedAt)}</span> : null}
                      <span className="num">版 {av?.revision ?? '—'}</span>
                    </div>
                  </div>
                  <div className="rowlist__actions">
                    {av ? (
                      <Link to={`/templates/${t.id}/versions/${av.revision}`} className="btn btn-small">
                        版の詳細
                      </Link>
                    ) : null}
                    <Button small variant="primary" onClick={() => navigate(`/drafts/new?templateVersionId=${av?.id ?? ''}`)} disabledReason={reason}>
                      この書式で作成
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
