/** S08 /documents: 案件/種類/状態 → 更新順の文書行。検索 0 件は条件解除、空は作成へ */
import { useState } from 'react';
import { Link } from 'react-router';
import type { Draft } from '@raylow/contracts';
import { useDocuments } from '../api/drafts';
import { Badge, statusTone } from '../components/Badge';
import { Button, LinkButton } from '../components/Button';
import { Checkbox } from '../components/Checkbox';
import { Field } from '../components/Field';
import { Input } from '../components/Input';
import { PageHeader } from '../components/PageHeader';
import { Select } from '../components/Select';
import { EmptyState, ErrorState, LoadingState } from '../components/States';
import { formatDateTime } from '../lib/format';
import { DRAFT_STATUS_LABEL, RECIPIENT_TYPE_LABEL, TEMPLATE_KIND_LABEL, draftStatusLabel, templateKindLabel } from '../lib/labels';

export function openPathFor(d: Draft): string {
  return d.status === 'approved' || d.status === 'superseded' || d.status === 'archived' ? `/documents/${d.id}/output` : `/drafts/${d.id}/edit`;
}

export function DocumentsPage() {
  const [q, setQ] = useState('');
  const [kind, setKind] = useState('');
  const [status, setStatus] = useState('');
  const [mine, setMine] = useState(false);
  const list = useDocuments({ q: q.trim() || undefined, kind: kind || undefined, status: status || undefined, mine });
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  const filtered = !!(q.trim() || kind || status || mine);
  const clear = () => {
    setQ('');
    setKind('');
    setStatus('');
    setMine(false);
  };
  return (
    <div className="container">
      <PageHeader title="書類" lead="作成済みの書類を検索します。承認済みは出力画面、作成中は編集画面を開きます。" actions={<LinkButton to="/drafts/new" variant="primary" icon="create">新しい書類を作る</LinkButton>} />
      <div className="stack">
        <div className="form-grid">
          <Field label="検索（表題・案件名）">{({ id }) => <Input id={id} value={q} onValueChange={setQ} autoComplete="off" placeholder="表記ゆれを含めて検索" />}</Field>
          <Field label="種類">{({ id }) => <Select id={id} value={kind} onValueChange={setKind} placeholder="すべて" options={Object.entries(TEMPLATE_KIND_LABEL).map(([v, l]) => ({ value: v, label: l }))} />}</Field>
          <Field label="状態">{({ id }) => <Select id={id} value={status} onValueChange={setStatus} placeholder="すべて" options={Object.entries(DRAFT_STATUS_LABEL).map(([v, l]) => ({ value: v, label: l }))} />}</Field>
          <div style={{ alignSelf: 'end' }}>
            <Checkbox checked={mine} onCheckedChange={setMine} label="自分が関わった書類のみ" />
          </div>
        </div>
        {list.isLoading ? <LoadingState /> : null}
        {list.isError ? <ErrorState error={list.error} onRetry={() => void list.refetch()} /> : null}
        {list.isSuccess && items.length === 0 ? (
          filtered ? (
            <EmptyState title="条件に一致する書類がありません" action={<Button onClick={clear}>検索条件を解除</Button>} />
          ) : (
            <EmptyState title="書類はまだありません" action={<LinkButton to="/drafts/new" variant="primary">新しい書類を作る</LinkButton>}>
              案件・書式・宛先を選ぶと草案が作られます。
            </EmptyState>
          )
        ) : null}
        {items.length > 0 ? (
          <ul className="rowlist" aria-label="書類一覧（更新順）">
            {items.map((d) => (
              <li key={d.id} className="rowlist__item">
                <div className="rowlist__main">
                  <div className="rowlist__title">
                    <Link to={openPathFor(d)}>{d.titleRaw}</Link>
                  </div>
                  <div className="rowlist__meta">
                    <span>{d.matterTitleRaw}</span>
                    <span>{templateKindLabel(d.kind)}</span>
                    <span>{RECIPIENT_TYPE_LABEL[d.recipientType]}</span>
                    <Badge tone={statusTone(d.status)}>{draftStatusLabel(d.status)}</Badge>
                    <time dateTime={d.updatedAt}>{formatDateTime(d.updatedAt)}</time>
                    {d.batchId ? <Badge tone="muted">一括</Badge> : null}
                  </div>
                </div>
                <div className="rowlist__actions">
                  <Link to={`/drafts/${d.id}/edit`} className="btn btn-small">編集</Link>
                  <Link to={`/documents/${d.id}/output`} className="btn btn-small">出力</Link>
                </div>
              </li>
            ))}
          </ul>
        ) : null}
        {list.hasNextPage ? <div><Button onClick={() => void list.fetchNextPage()} busy={list.isFetchingNextPage}>さらに読み込む</Button></div> : null}
      </div>
    </div>
  );
}
