/** S15 /contacts: 氏名 → 所属 → 住所 → 確認日。類似名は提案のみ、merge 禁止 */
import { useState } from 'react';
import type { Contact, ContactType } from '@raylow/contracts';
import { useAddAlias, useContactSearch, useCreateContact, useUpdateContact, type ContactInput } from '../api/masters';
import { fieldErrorMap, isApiError } from '../lib/apiClient';
import { formatDate } from '../lib/format';
import { CONTACT_TYPE_LABEL } from '../lib/labels';
import { Alert } from '../components/Alert';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { Checkbox } from '../components/Checkbox';
import { Field } from '../components/Field';
import { Input } from '../components/Input';
import { PageHeader } from '../components/PageHeader';
import { Select } from '../components/Select';
import { EmptyState, ErrorState, LoadingState } from '../components/States';
import { TextArea } from '../components/TextArea';

const EMPTY: ContactInput = { type: 'person', nameRaw: '', kana: '', organizationNameRaw: '', addressRaw: '', postcodeRaw: '', channels: {}, notesRaw: '' };

export function ContactsPage() {
  const [q, setQ] = useState('');
  const [type, setType] = useState('');
  const [exact, setExact] = useState(false);
  const [editing, setEditing] = useState<Contact | 'new' | null>(null);
  const search = useContactSearch({ q: q.trim(), type: (type || undefined) as ContactType | undefined, mode: exact ? 'exact' : 'normalized', limit: 100 }, true);
  const results = search.data ?? [];
  const nameCounts = new Map<string, number>();
  for (const c of results) nameCounts.set(c.nameRaw, (nameCounts.get(c.nameRaw) ?? 0) + 1);
  return (
    <div className="container">
      <PageHeader title="連絡先" lead="依頼者・相手方・相手方代理人などの連絡先です。同姓同名は所属・住所で識別し、自動では統合（merge）しません。" actions={<Button variant="primary" icon="plus" onClick={() => setEditing('new')}>連絡先を登録</Button>} />
      <div className="stack">
        {editing ? <ContactForm initial={editing === 'new' ? null : editing} onClose={() => setEditing(null)} /> : null}
        <div className="form-grid">
          <Field label="検索（氏名・所属・別名）">{({ id }) => <Input id={id} value={q} onValueChange={setQ} autoComplete="off" />}</Field>
          <Field label="種別">{({ id }) => <Select id={id} value={type} onValueChange={setType} placeholder="すべて" options={Object.entries(CONTACT_TYPE_LABEL).map(([v, l]) => ({ value: v, label: l }))} />}</Field>
          <div style={{ alignSelf: 'end' }}><Checkbox checked={exact} onCheckedChange={setExact} label="原文一致のみ（表記ゆれを含めない）" /></div>
        </div>
        {search.isLoading ? <LoadingState /> : null}
        {search.isError ? <ErrorState error={search.error} onRetry={() => void search.refetch()} /> : null}
        {search.isSuccess && results.length === 0 ? <EmptyState title={q ? '該当する連絡先がありません' : '連絡先がまだありません'} action={<Button variant="primary" onClick={() => setEditing('new')}>連絡先を登録</Button>} /> : null}
        {results.length > 0 ? (
          <div className="table-wrap">
            <table className="table">
              <caption className="sr-only">連絡先の検索結果</caption>
              <thead><tr><th scope="col">氏名</th><th scope="col">種別</th><th scope="col">所属</th><th scope="col">住所</th><th scope="col">確認日</th><th scope="col">一致</th><th scope="col">操作</th></tr></thead>
              <tbody>
                {results.map((c) => (
                  <tr key={c.id}>
                    <td className="cell-raw"><b>{c.nameRaw}</b>{c.kana ? <div className="aux muted">{c.kana}</div> : null}{(nameCounts.get(c.nameRaw) ?? 0) > 1 ? <div><Badge tone="warning">同姓同名あり</Badge></div> : null}{c.aliases.length > 0 ? <div className="aux muted">別名: {c.aliases.map((a) => a.aliasRaw).join('、')}</div> : null}</td>
                    <td>{CONTACT_TYPE_LABEL[c.type] ?? c.type}</td>
                    <td className="cell-raw">{c.organizationNameRaw || '—'}</td>
                    <td className="cell-raw">{c.postcodeRaw} {c.addressRaw || '—'}</td>
                    <td>{formatDate(c.checkedAt)}</td>
                    <td>{c.matchReason === 'normalized' ? '表記ゆれ' : c.matchReason === 'alias' ? '別名' : c.matchReason === 'exact' ? '原文' : ''}</td>
                    <td className="actions"><Button small onClick={() => setEditing(c)}>編集</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ContactForm({ initial, onClose }: { initial: Contact | null; onClose: () => void }) {
  const create = useCreateContact();
  const update = useUpdateContact();
  const addAlias = useAddAlias();
  const [form, setForm] = useState<ContactInput>(initial ? { type: initial.type, nameRaw: initial.nameRaw, kana: initial.kana, organizationNameRaw: initial.organizationNameRaw, addressRaw: initial.addressRaw, postcodeRaw: initial.postcodeRaw, channels: initial.channels, notesRaw: initial.notesRaw, checkedAt: initial.checkedAt } : EMPTY);
  const [alias, setAlias] = useState('');
  const [similar, setSimilar] = useState<string[]>([]);
  const err = create.error ?? update.error;
  const errors = fieldErrorMap(err);
  const set = <K extends keyof ContactInput>(k: K, v: ContactInput[K]) => setForm({ ...form, [k]: v });
  const ch = form.channels ?? {};
  const submit = async () => {
    try {
      if (initial) await update.mutateAsync({ id: initial.id, patch: form, expectedVersion: initial.version });
      else {
        const c = await create.mutateAsync(form);
        if (c.similarIds && c.similarIds.length > 0) {
          setSimilar(c.similarIds);
          return;
        }
      }
      onClose();
    } catch {
      /* 表示は errors */
    }
  };
  return (
    <form className="band stack" onSubmit={(e) => { e.preventDefault(); void submit(); }} noValidate>
      <h2 style={{ fontSize: 18 }}>{initial ? '連絡先を編集（新しい版を snapshot）' : '連絡先を登録'}</h2>
      {err ? <Alert kind="error" live>{isApiError(err) ? err.userMessage() : '保存に失敗しました'}</Alert> : null}
      {similar.length > 0 ? <Alert kind="warning" title="類似する連絡先があります（統合はしません）">登録は完了しました。類似候補 {similar.length} 件があります。同一人物の別表記なら、既存の連絡先に「別名」を追加する運用を検討してください。別名辞書は明示登録のみで、自動名寄せはしません。</Alert> : null}
      <div className="form-grid">
        <Field label="種別" required>{({ id }) => <Select id={id} value={form.type} onValueChange={(v) => set('type', v as ContactType)} options={Object.entries(CONTACT_TYPE_LABEL).map(([v, l]) => ({ value: v, label: l }))} />}</Field>
        <Field label="氏名・名称（原文）" required error={errors.nameRaw}>{({ id, describedBy, invalid }) => <Input id={id} value={form.nameRaw} onValueChange={(v) => set('nameRaw', v)} aria-describedby={describedBy} invalid={invalid} autoComplete="off" />}</Field>
        <Field label="かな" error={errors.kana}>{({ id, describedBy, invalid }) => <Input id={id} value={form.kana ?? ''} onValueChange={(v) => set('kana', v)} aria-describedby={describedBy} invalid={invalid} autoComplete="off" />}</Field>
        <Field label="所属（事務所・会社）" error={errors.organizationNameRaw} hint="同姓同名の識別に使います">{({ id, describedBy, invalid }) => <Input id={id} value={form.organizationNameRaw ?? ''} onValueChange={(v) => set('organizationNameRaw', v)} aria-describedby={describedBy} invalid={invalid} autoComplete="off" />}</Field>
        <Field label="郵便番号" error={errors.postcodeRaw}>{({ id, describedBy, invalid }) => <Input id={id} value={form.postcodeRaw ?? ''} onValueChange={(v) => set('postcodeRaw', v)} aria-describedby={describedBy} invalid={invalid} autoComplete="off" />}</Field>
        <Field label="住所" error={errors.addressRaw} className="span-all">{({ id, describedBy, invalid }) => <Input id={id} value={form.addressRaw ?? ''} onValueChange={(v) => set('addressRaw', v)} aria-describedby={describedBy} invalid={invalid} autoComplete="off" />}</Field>
        <Field label="電話">{({ id }) => <Input id={id} value={ch.phone ?? ''} onValueChange={(v) => set('channels', { ...ch, phone: v })} autoComplete="off" />}</Field>
        <Field label="FAX">{({ id }) => <Input id={id} value={ch.fax ?? ''} onValueChange={(v) => set('channels', { ...ch, fax: v })} autoComplete="off" />}</Field>
        <Field label="メール">{({ id }) => <Input id={id} value={ch.email ?? ''} onValueChange={(v) => set('channels', { ...ch, email: v })} autoComplete="off" />}</Field>
        <Field label="確認日" hint="住所・所属を確認した日">{({ id }) => <Input id={id} type="date" value={(form.checkedAt ?? '').slice(0, 10)} onValueChange={(v) => set('checkedAt', v ? new Date(`${v}T00:00:00+09:00`).toISOString() : null)} />}</Field>
      </div>
      <Field label="メモ">{({ id }) => <TextArea id={id} short value={form.notesRaw ?? ''} onValueChange={(v) => set('notesRaw', v)} />}</Field>
      <div className="row"><Button type="submit" variant="primary" busy={create.isPending || update.isPending} disabledReason={!form.nameRaw.trim() ? '氏名を入力してください' : undefined}>{initial ? '保存' : '登録'}</Button><Button variant="quiet" onClick={onClose}>閉じる</Button></div>
      {initial ? (
        <div className="row" style={{ borderTop: 'var(--divider-width) solid var(--color-line)', paddingTop: 'var(--space-3)' }}>
          <Field label="別名を追加（明示登録。自動名寄せはしません）">{({ id }) => <Input id={id} value={alias} onValueChange={setAlias} autoComplete="off" />}</Field>
          <Button small busy={addAlias.isPending} disabledReason={!alias.trim() ? '別名を入力' : undefined} onClick={() => void addAlias.mutateAsync({ id: initial.id, aliasRaw: alias }).then(() => setAlias('')).catch(() => undefined)}>別名を追加</Button>
        </div>
      ) : null}
    </form>
  );
}
