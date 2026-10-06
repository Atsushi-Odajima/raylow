/**
 * S12 /phrases: 用途 → 本文 → 承認状態。PC はリストから全文編集、mobile は独立編集画面。
 * 旧文例を使う草案には更新候補のみ（自動で書き換えない）。
 */
import { useEffect, useState } from 'react';
import type { Phrase } from '@raylow/contracts';
import { TemplateKindSchema } from '@raylow/template-schema';
import { useAddPhraseVersion, useApprovePhraseVersion, useCreatePhrase, usePhrase, usePhrases } from '../api/templates';
import { isApiError } from '../lib/apiClient';
import { formatDateTime } from '../lib/format';
import { PHRASE_STATUS_LABEL, TEMPLATE_KIND_LABEL, label, templateKindLabel } from '../lib/labels';
import { useSession } from '../lib/session';
import { useIsMobile } from '../hooks/useMediaQuery';
import { Alert } from '../components/Alert';
import { Badge, statusTone } from '../components/Badge';
import { Button } from '../components/Button';
import { Checkbox } from '../components/Checkbox';
import { Field } from '../components/Field';
import { Input } from '../components/Input';
import { PageHeader } from '../components/PageHeader';
import { Select } from '../components/Select';
import { EmptyState, ErrorState, LoadingState } from '../components/States';
import { TextArea } from '../components/TextArea';
import { unsavedRegistry } from '../lib/unsaved';

export function PhrasesPage() {
  const isMobile = useIsMobile();
  const [kind, setKind] = useState('');
  const [selected, setSelected] = useState<string | 'new' | null>(null);
  const list = usePhrases({ templateKind: kind || undefined });
  const showList = !isMobile || selected == null;
  const showEditor = !isMobile || selected != null;
  return (
    <div className="container">
      <PageHeader title="所内文例" lead="承認済み文例は草案の本文へ挿入できます。承認済みでも個別案件への適用は利用者の判断です。" actions={<Button variant="primary" icon="plus" onClick={() => setSelected('new')}>文例を追加</Button>} />
      <div className={isMobile ? 'stack' : 'two-pane'}>
        {showList ? (
          <div className="stack">
            <Field label="用途（書式の種類）">{({ id }) => <Select id={id} value={kind} onValueChange={setKind} placeholder="すべて" options={Object.entries(TEMPLATE_KIND_LABEL).map(([v, l]) => ({ value: v, label: l }))} />}</Field>
            {list.isLoading ? <LoadingState /> : null}
            {list.isError ? <ErrorState error={list.error} onRetry={() => void list.refetch()} /> : null}
            {list.data && list.data.length === 0 ? <EmptyState title="文例がありません" action={<Button variant="primary" onClick={() => setSelected('new')}>文例を追加</Button>} /> : null}
            {list.data && list.data.length > 0 ? (
              <ul className="rowlist" aria-label="文例一覧">
                {list.data.map((p) => (
                  <li key={p.id} className="rowlist__item" aria-selected={selected === p.id ? true : undefined}>
                    <div className="rowlist__main">
                      <button type="button" className="rowlist__title" style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', textAlign: 'left', color: 'var(--color-primary)', textDecoration: 'underline', textUnderlineOffset: 3 }} onClick={() => setSelected(p.id)}>{p.title}</button>
                      <div className="rowlist__meta">
                        <span>{p.category || '分類なし'}</span>
                        {p.templateKind ? <span>{templateKindLabel(p.templateKind)}</span> : null}
                        <Badge tone={statusTone(p.currentVersion?.status ?? '')}>{p.currentVersion ? label(PHRASE_STATUS_LABEL, p.currentVersion.status) : '版なし'}</Badge>
                        <time dateTime={p.updatedAt}>{formatDateTime(p.updatedAt)}</time>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
        {showEditor ? (
          <div className="stack">
            {isMobile ? <div><Button small variant="quiet" onClick={() => setSelected(null)}>← 一覧へ</Button></div> : null}
            {selected === 'new' ? <NewPhraseForm onCreated={(p) => setSelected(p.id)} /> : selected ? <PhraseEditor id={selected} /> : <div className="state-box muted">左の一覧から文例を選ぶか、「文例を追加」してください。</div>}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function NewPhraseForm({ onCreated }: { onCreated: (p: Phrase) => void }) {
  const create = useCreatePhrase();
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('');
  const [kind, setKind] = useState('');
  const [body, setBody] = useState('');
  return (
    <form className="band stack" onSubmit={(e) => { e.preventDefault(); void create.mutateAsync({ title, category, templateKind: kind ? TemplateKindSchema.parse(kind) : null, bodyRaw: body }).then(onCreated).catch(() => undefined); }} noValidate>
      <h2 style={{ fontSize: 18 }}>文例を追加</h2>
      {create.isError ? <Alert kind="error" live>{isApiError(create.error) ? create.error.userMessage() : '追加に失敗しました'}</Alert> : null}
      <Field label="表題" required>{({ id }) => <Input id={id} value={title} onValueChange={setTitle} autoComplete="off" />}</Field>
      <div className="form-grid">
        <Field label="分類">{({ id }) => <Input id={id} value={category} onValueChange={setCategory} autoComplete="off" />}</Field>
        <Field label="対象書式">{({ id }) => <Select id={id} value={kind} onValueChange={setKind} placeholder="指定なし" options={Object.entries(TEMPLATE_KIND_LABEL).map(([v, l]) => ({ value: v, label: l }))} />}</Field>
      </div>
      <Field label="本文（原文のまま保存）" required>{({ id }) => <TextArea id={id} value={body} onValueChange={setBody} />}</Field>
      <div><Button type="submit" variant="primary" busy={create.isPending} disabledReason={!title.trim() || !body.trim() ? '表題と本文を入力してください' : undefined}>下書きとして保存</Button></div>
    </form>
  );
}

function PhraseEditor({ id }: { id: string }) {
  const session = useSession();
  const isLawyer = session.info?.role === 'lawyer';
  const q = usePhrase(id);
  const addVersion = useAddPhraseVersion();
  const approve = useApprovePhraseVersion();
  const [body, setBody] = useState('');
  const [dirty, setDirty] = useState(false);
  const [requestApproval, setRequestApproval] = useState(false);
  const [confirmed, setConfirmed] = useState({ content: false, residual: false });
  useEffect(() => {
    if (q.data?.currentVersion && !dirty) setBody(q.data.currentVersion.bodyRaw);
  }, [q.data, dirty]);
  useEffect(() => {
    unsavedRegistry.set(`phrase:${id}`, dirty);
    return () => unsavedRegistry.clear(`phrase:${id}`);
  }, [dirty, id]);
  if (q.isLoading) return <LoadingState />;
  if (q.isError || !q.data) return <ErrorState error={q.error ?? new Error('not found')} onRetry={() => void q.refetch()} />;
  const p = q.data;
  const cur = p.currentVersion;
  return (
    <div className="band stack">
      <div className="row-between">
        <h2 style={{ fontSize: 18 }}>{p.title}</h2>
        <div className="row aux"><span>{p.category || '分類なし'}</span>{p.templateKind ? <span>{templateKindLabel(p.templateKind)}</span> : null}<Badge tone={statusTone(cur?.status ?? '')}>{cur ? label(PHRASE_STATUS_LABEL, cur.status) : '版なし'}</Badge><span className="num">版 {cur?.revision ?? '—'}</span></div>
      </div>
      <Alert kind="info">保存すると新しい版になります。旧版を使っている草案は自動では書き換わらず、「更新候補」として表示されます。</Alert>
      {addVersion.isError ? <Alert kind="error" live>{isApiError(addVersion.error) ? addVersion.error.userMessage() : '保存に失敗しました'}</Alert> : null}
      {approve.isError ? <Alert kind="error" live>{isApiError(approve.error) ? approve.error.userMessage() : '承認に失敗しました'}</Alert> : null}
      <Field label="本文" hint={dirty ? '未保存の変更があります' : undefined}>{({ id: fid }) => <TextArea id={fid} value={body} onValueChange={(v) => { setBody(v); setDirty(true); }} />}</Field>
      <Checkbox checked={requestApproval} onCheckedChange={setRequestApproval} label="保存と同時に承認を依頼する" />
      <div className="row">
        <Button variant="primary" busy={addVersion.isPending} disabledReason={!dirty ? '変更がありません' : !body.trim() ? '本文を入力してください' : undefined} onClick={() => void addVersion.mutateAsync({ id, bodyRaw: body, requestApproval }).then(() => setDirty(false)).catch(() => undefined)}>版を保存</Button>
      </div>
      {cur && cur.status !== 'approved' && isLawyer ? (
        <div className="stack-s" style={{ borderTop: 'var(--divider-width) solid var(--color-line)', paddingTop: 'var(--space-3)' }}>
          <h3>承認（弁護士）</h3>
          <Checkbox checked={confirmed.content} onCheckedChange={(c) => setConfirmed({ ...confirmed, content: c })} label="文例の内容を確認した" />
          <Checkbox checked={confirmed.residual} onCheckedChange={(c) => setConfirmed({ ...confirmed, residual: c })} label="他案件の実名・住所などの残存が無いことを確認した" />
          <div><Button icon="check" busy={approve.isPending} disabledReason={dirty ? '未保存の変更があります。先に版を保存してください' : !(confirmed.content && confirmed.residual) ? '2 つの確認にチェックしてください' : undefined} onClick={() => approve.mutate({ versionId: cur.id })}>現在の版を承認</Button></div>
        </div>
      ) : null}
      {p.versions && p.versions.length > 0 ? (
        <details>
          <summary>版の履歴（{p.versions.length}）</summary>
          <ul className="rowlist">{[...p.versions].sort((a, b) => b.revision - a.revision).map((v) => <li key={v.id} className="rowlist__item"><div className="rowlist__main"><div className="rowlist__title num">版 {v.revision} <Badge tone={statusTone(v.status)}>{label(PHRASE_STATUS_LABEL, v.status)}</Badge></div><div className="rowlist__meta"><time dateTime={v.createdAt}>{formatDateTime(v.createdAt)}</time>{v.approvedAt ? <span>承認 {formatDateTime(v.approvedAt)}</span> : null}</div><div className="aux cell-raw" style={{ marginTop: 4 }}>{v.bodyRaw.slice(0, 200)}{v.bodyRaw.length > 200 ? '…' : ''}</div></div></li>)}</ul>
        </details>
      ) : null}
    </div>
  );
}
