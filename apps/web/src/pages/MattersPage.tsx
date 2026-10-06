/** S14 /matters: 検索 → 行 → 詳細。案件登録 */
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useCreateMatter, useMatters, type MatterInput } from '../api/matters';
import { fieldErrorMap, isApiError } from '../lib/apiClient';
import { formatDateTime } from '../lib/format';
import { ACCEPTANCE_LABEL, MATTER_STATUS_LABEL, label } from '../lib/labels';
import { Alert } from '../components/Alert';
import { Badge, statusTone } from '../components/Badge';
import { Button } from '../components/Button';
import { Field } from '../components/Field';
import { Input } from '../components/Input';
import { PageHeader } from '../components/PageHeader';
import { Select } from '../components/Select';
import { EmptyState, ErrorState, LoadingState } from '../components/States';
import { TextArea } from '../components/TextArea';

export function MattersPage() {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [open, setOpen] = useState(false);
  const list = useMatters({ q: q.trim() || undefined, status: status || undefined, limit: 100 });
  return (
    <div className="container">
      <PageHeader title="案件" lead="差込元になる事件情報（当事者・代理人・裁判所・事件番号・受任範囲）です。案件情報を変更しても過去に作成した書面は変わりません。" actions={<Button variant="primary" icon="plus" onClick={() => setOpen((o) => !o)}>案件を登録</Button>} />
      <div className="stack">
        {open ? <NewMatterForm onDone={() => setOpen(false)} /> : null}
        <div className="form-grid">
          <Field label="検索（案件名・事件番号。表記ゆれを含む）">{({ id }) => <Input id={id} value={q} onValueChange={setQ} autoComplete="off" />}</Field>
          <Field label="状態">{({ id }) => <Select id={id} value={status} onValueChange={setStatus} placeholder="すべて" options={Object.entries(MATTER_STATUS_LABEL).map(([v, l]) => ({ value: v, label: l }))} />}</Field>
        </div>
        {list.isLoading ? <LoadingState /> : null}
        {list.isError ? <ErrorState error={list.error} onRetry={() => void list.refetch()} /> : null}
        {list.data && list.data.length === 0 ? <EmptyState title={q || status ? '条件に一致する案件がありません' : '案件がまだありません'} action={q || status ? <Button onClick={() => { setQ(''); setStatus(''); }}>条件を解除</Button> : <Button variant="primary" onClick={() => setOpen(true)}>案件を登録</Button>}>表示されるのは自分がメンバーの案件だけです。</EmptyState> : null}
        {list.data && list.data.length > 0 ? (
          <ul className="rowlist" aria-label="案件一覧">
            {list.data.map((m) => (
              <li key={m.id} className="rowlist__item">
                <div className="rowlist__main">
                  <div className="rowlist__title"><Link to={`/matters/${m.id}`}>{m.titleRaw}</Link></div>
                  <div className="rowlist__meta">
                    <span>{m.caseNumberRaw || '事件番号なし'}</span><span>{m.courtRaw || '裁判所未設定'}{m.courtDepartmentRaw ? ` ${m.courtDepartmentRaw}` : ''}</span>
                    <Badge tone={statusTone(m.status)}>{label(MATTER_STATUS_LABEL, m.status)}</Badge>
                    <Badge tone={m.acceptanceStatus === 'confirmed' ? 'success' : 'warning'}>{label(ACCEPTANCE_LABEL, m.acceptanceStatus)}</Badge>
                    {m.legalHold ? <Badge tone="error">legal hold</Badge> : null}
                    <time dateTime={m.updatedAt}>{formatDateTime(m.updatedAt)}</time>
                    {m.matchReason === 'normalized' ? <span>表記ゆれ一致</span> : null}
                  </div>
                </div>
                <div className="rowlist__actions"><Link to={`/drafts/new?matterId=${m.id}`} className="btn btn-small btn-primary">この案件で作成</Link></div>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}

export function NewMatterForm({ onDone }: { onDone: () => void }) {
  const navigate = useNavigate();
  const create = useCreateMatter();
  const [form, setForm] = useState<MatterInput>({ titleRaw: '', caseNumberRaw: '', courtRaw: '', courtDepartmentRaw: '', scopeRaw: '' });
  const errors = fieldErrorMap(create.error);
  return (
    <form className="band stack" onSubmit={(e) => { e.preventDefault(); void create.mutateAsync(form).then((m) => { onDone(); navigate(`/matters/${m.id}`); }).catch(() => undefined); }} noValidate>
      <h2 style={{ fontSize: 18 }}>案件を登録</h2>
      {create.isError ? <Alert kind="error" live>{isApiError(create.error) ? create.error.userMessage() : '登録に失敗しました'}</Alert> : null}
      <Field label="案件名" required error={errors.titleRaw}>{({ id, describedBy, invalid }) => <Input id={id} value={form.titleRaw} onValueChange={(v) => setForm({ ...form, titleRaw: v })} aria-describedby={describedBy} invalid={invalid} autoComplete="off" />}</Field>
      <div className="form-grid">
        <Field label="事件番号（原文）" error={errors.caseNumberRaw} hint="先頭の 0・全角はそのまま保存。構造化は確認待ちになります">{({ id, describedBy, invalid }) => <Input id={id} value={form.caseNumberRaw ?? ''} onValueChange={(v) => setForm({ ...form, caseNumberRaw: v })} aria-describedby={describedBy} invalid={invalid} autoComplete="off" />}</Field>
        <Field label="裁判所" error={errors.courtRaw}>{({ id, describedBy, invalid }) => <Input id={id} value={form.courtRaw ?? ''} onValueChange={(v) => setForm({ ...form, courtRaw: v })} aria-describedby={describedBy} invalid={invalid} autoComplete="off" />}</Field>
        <Field label="部・係" error={errors.courtDepartmentRaw}>{({ id, describedBy, invalid }) => <Input id={id} value={form.courtDepartmentRaw ?? ''} onValueChange={(v) => setForm({ ...form, courtDepartmentRaw: v })} aria-describedby={describedBy} invalid={invalid} autoComplete="off" />}</Field>
      </div>
      <Field label="受任範囲" error={errors.scopeRaw}>{({ id, describedBy, invalid }) => <TextArea id={id} short value={form.scopeRaw ?? ''} onValueChange={(v) => setForm({ ...form, scopeRaw: v })} aria-describedby={describedBy} invalid={invalid} />}</Field>
      <div className="row"><Button type="submit" variant="primary" busy={create.isPending} disabledReason={!form.titleRaw.trim() ? '案件名を入力してください' : undefined}>登録</Button><Button variant="quiet" onClick={onDone}>閉じる</Button></div>
    </form>
  );
}
