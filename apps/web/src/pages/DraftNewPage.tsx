/**
 * S04 /drafts/new: 案件 → 書式 → 宛先 → 不足 → POST /api/drafts → S05。
 * PC は同一フォーム、mobile は段階式。同姓同名は所属確認（ContactPicker）。案件未登録は最小項目だけ登録して戻る。
 * 相手方本人宛てで代理人がいる場合は確認チェック（システムは可否を判定しない）。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import type { MatterSummary, RecipientType } from '@raylow/contracts';
import { TemplateFieldSchemaSchema } from '@raylow/template-schema';
import { createDraft } from '../api/drafts';
import { useCreateMatter, useMatter, type MatterInput } from '../api/matters';
import { useTemplateVersion, useTemplates } from '../api/templates';
import { fieldErrorMap, isApiError } from '../lib/apiClient';
import { newUuid } from '../lib/ids';
import { ACCEPTANCE_LABEL, PARTY_ROLE_LABEL, RECIPIENT_TYPE_LABEL, TEMPLATE_SCOPE_LABEL, label, templateKindLabel } from '../lib/labels';
import { useIsMobile } from '../hooks/useMediaQuery';
import { Alert } from '../components/Alert';
import { Badge, SampleOnlyBadge } from '../components/Badge';
import { Button } from '../components/Button';
import { Checkbox } from '../components/Checkbox';
import { ContactPicker, type ContactLite } from '../components/ContactPicker';
import { Field } from '../components/Field';
import { Input } from '../components/Input';
import { MatterPicker } from '../components/MatterPicker';
import { PageHeader } from '../components/PageHeader';
import { Select } from '../components/Select';
import { Stepper } from '../components/Stepper';
import { TextArea } from '../components/TextArea';
import { ErrorState, LoadingState } from '../components/States';
import { Icon } from '../components/Icon';

type StepKey = 'matter' | 'template' | 'recipient' | 'summary';
const STEPS: StepKey[] = ['matter', 'template', 'recipient', 'summary'];
const NEEDS_CONTACT: RecipientType[] = ['opponent_agent', 'opponent', 'client', 'third_party'];

export function DraftNewPage() {
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [step, setStep] = useState<StepKey>('matter');
  const [matter, setMatter] = useState<MatterSummary | null>(null);
  const [templateVersionId, setTemplateVersionId] = useState<string | null>(params.get('templateVersionId'));
  const [recipientType, setRecipientType] = useState<RecipientType | null>(null);
  const [contact, setContact] = useState<ContactLite | null>(null);
  const [confirmDirect, setConfirmDirect] = useState(false);
  const [titleRaw, setTitleRaw] = useState('');
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const idempotencyKey = useRef(newUuid());

  const matterDetail = useMatter(matter?.id);
  const templates = useTemplates({ status: 'published' });
  const tv = useTemplateVersion(templateVersionId);
  const schema = useMemo(() => {
    const r = TemplateFieldSchemaSchema.safeParse(tv.data?.fieldSchema);
    return r.success ? r.data : null;
  }, [tv.data]);
  const allowedTypes: RecipientType[] = schema?.recipientTypes ?? ['opponent_agent', 'opponent', 'client', 'court', 'third_party', 'none'];

  useEffect(() => {
    if (recipientType && !allowedTypes.includes(recipientType)) {
      setRecipientType(null);
      setContact(null);
    }
  }, [allowedTypes, recipientType]);

  const preselectedMatterId = params.get('matterId');
  const preselected = useMatter(preselectedMatterId);
  useEffect(() => {
    if (preselected.data && !matter) setMatter(preselected.data);
  }, [preselected.data, matter]);

  // 代理人がいる相手方本人を宛先にしようとしているか
  const opponentHasAgent = useMemo(() => {
    if (recipientType !== 'opponent' || !contact || !matterDetail.data) return false;
    const party = matterDetail.data.parties.find((p) => p.contactId === contact.id);
    if (!party) return false;
    const today = new Date().toISOString().slice(0, 10);
    return matterDetail.data.agents.some((a) => a.representedPartyId === party.id && (a.validTo == null || a.validTo >= today) && (a.validFrom == null || a.validFrom <= today));
  }, [recipientType, contact, matterDetail.data]);

  const suggestions: ContactLite[] = useMemo(() => {
    const d = matterDetail.data;
    if (!d) return [];
    if (recipientType === 'opponent_agent') {
      return d.agents.map((a) => {
        const party = d.parties.find((p) => p.id === a.representedPartyId);
        return { ...a.lawyerContact, type: 'lawyer' as const, note: `${party ? party.contact.nameRaw : '当事者不明'} の代理人` };
      });
    }
    if (recipientType === 'opponent') return d.parties.filter((p) => p.role === 'opponent').map((p) => ({ ...p.contact, note: '相手方（当事者）' }));
    if (recipientType === 'client') return d.parties.filter((p) => p.role === 'client').map((p) => ({ ...p.contact, note: '依頼者（当事者）' }));
    if (recipientType === 'third_party') return d.parties.filter((p) => p.role === 'third_party' || p.role === 'co_party').map((p) => ({ ...p.contact, note: label(PARTY_ROLE_LABEL, p.role) }));
    return [];
  }, [matterDetail.data, recipientType]);

  const needsContact = recipientType != null && NEEDS_CONTACT.includes(recipientType);
  const stepDone: Record<StepKey, boolean> = {
    matter: !!matter,
    template: !!templateVersionId && !!tv.data,
    recipient: recipientType != null && (!needsContact || !!contact) && (!opponentHasAgent || confirmDirect),
    summary: false,
  };
  const canSubmit = stepDone.matter && stepDone.template && stepDone.recipient;
  const blockers: string[] = [];
  if (!matter) blockers.push('案件を選択してください');
  if (!templateVersionId) blockers.push('書式を選択してください');
  if (!recipientType) blockers.push('宛先種別を選択してください');
  else if (needsContact && !contact) blockers.push('宛先の連絡先を選択してください');
  if (opponentHasAgent && !confirmDirect) blockers.push('代理人がいる相手方本人宛ての確認チェックが必要です');

  const gaps = useMemo(() => {
    const out: Array<{ kind: 'warning' | 'info'; text: string }> = [];
    const d = matterDetail.data;
    if (tv.data?.sampleOnly) out.push({ kind: 'info', text: 'サンプル書式です。草案出力のみ可能で、正式出力には所内書式版としての承認が必要です。' });
    if (d && d.acceptanceStatus !== 'confirmed') out.push({ kind: 'warning', text: `受任確認が「${label(ACCEPTANCE_LABEL, d.acceptanceStatus)}」です。受任通知などの正式版は受任確認済みが条件です（案件画面で担当弁護士が確認します）。` });
    if (d && !d.leadLawyerId) out.push({ kind: 'warning', text: '担当弁護士が未設定です。差出人（担当弁護士）の差込が空になります。' });
    if (d && !d.parties.some((p) => p.role === 'client')) out.push({ kind: 'warning', text: '依頼者が案件に登録されていません。依頼者名の差込が空になります。' });
    if (contact && !contact.addressRaw) out.push({ kind: 'warning', text: '宛先の住所が未登録です。宛名の住所が空になります（連絡先画面で登録）。' });
    return out;
  }, [matterDetail.data, tv.data, contact]);

  const submit = async () => {
    if (!matter || !templateVersionId || !recipientType) return;
    setBusy(true);
    setSubmitError(null);
    setFieldErrors({});
    try {
      const d = await createDraft({
        matterId: matter.id,
        templateVersionId,
        recipientType,
        recipientContactId: needsContact ? contact?.id ?? null : null,
        ...(opponentHasAgent ? { confirmDirectToOpponent: confirmDirect } : {}),
        idempotencyKey: idempotencyKey.current,
        ...(titleRaw.trim() ? { titleRaw } : {}),
      });
      navigate(`/drafts/${d.draft.id}/edit`, { replace: true });
    } catch (e) {
      if (isApiError(e)) {
        setFieldErrors(fieldErrorMap(e));
        if (e.code === 'template_not_published' || e.code === 'template_sample_only') setSubmitError(`${e.userMessage()} 書式を選び直してください。`);
        else setSubmitError(e.userMessage());
      } else setSubmitError('作成に失敗しました。');
    } finally {
      setBusy(false);
    }
  };

  const show = (k: StepKey) => !isMobile || step === k;
  const idx = STEPS.indexOf(step);

  return (
    <div className="container">
      <PageHeader title="書類を作る" lead="案件・書式・宛先を選びます。登録済みの情報は再入力しません。" crumbs={[{ to: '/create', label: '作成' }, { label: '新規作成' }]} />
      {isMobile ? (
        <div style={{ marginBottom: 'var(--space-4)' }}>
          <Stepper
            label="作成の工程"
            current={step}
            onSelect={setStep}
            steps={[
              { key: 'matter', label: '案件', done: stepDone.matter },
              { key: 'template', label: '書式', done: stepDone.template },
              { key: 'recipient', label: '宛先', done: stepDone.recipient },
              { key: 'summary', label: '不足の確認' },
            ]}
          />
        </div>
      ) : null}
      <div className="form-800 stack-l">
        {show('matter') ? (
          <section className="band" aria-labelledby="h-matter">
            <h2 id="h-matter" style={{ marginBottom: 'var(--space-4)' }}>
              1. 案件
            </h2>
            <MatterPicker selected={matter} onSelect={(m) => setMatter(m)} />
            {!matter ? <InlineMatterForm onCreated={(m) => setMatter(m)} /> : null}
            {fieldErrors.matterId ? <Alert kind="error">{fieldErrors.matterId}</Alert> : null}
          </section>
        ) : null}

        {show('template') ? (
          <section className="band" aria-labelledby="h-template">
            <h2 id="h-template" style={{ marginBottom: 'var(--space-4)' }}>
              2. 書式
            </h2>
            {templates.isLoading ? <LoadingState /> : null}
            {templates.isError ? <ErrorState error={templates.error} onRetry={() => void templates.refetch()} /> : null}
            {templates.data ? (
              <div className="candidate-list" role="radiogroup" aria-label="公開済みの書式">
                {templates.data.length === 0 ? <div className="muted">公開済みの書式がありません。書式画面で登録・公開してください。</div> : null}
                {templates.data.map((t) => {
                  const av = t.activeVersion;
                  if (!av || av.status !== 'published') return null;
                  const sel = av.id === templateVersionId;
                  return (
                    <button key={t.id} type="button" role="radio" aria-checked={sel} aria-pressed={sel} className="candidate" onClick={() => setTemplateVersionId(av.id)}>
                      <span>
                        <b>{t.name}</b> <span className="aux muted">{templateKindLabel(t.kind)} ／ {label(TEMPLATE_SCOPE_LABEL, av.scope)}</span> {av.sampleOnly ? <SampleOnlyBadge /> : null}
                      </span>
                      <span className="candidate__meta num">版 {av.revision}</span>
                    </button>
                  );
                })}
              </div>
            ) : null}
            {fieldErrors.templateVersionId ? <Alert kind="error">{fieldErrors.templateVersionId}</Alert> : null}
          </section>
        ) : null}

        {show('recipient') ? (
          <section className="band" aria-labelledby="h-recipient">
            <h2 id="h-recipient" style={{ marginBottom: 'var(--space-4)' }}>
              3. 宛先
            </h2>
            <div className="stack">
              <Field label="宛先種別" required hint={schema ? 'この書式で選べる種別だけ表示しています' : undefined}>
                {({ id, describedBy }) => (
                  <Select
                    id={id}
                    aria-describedby={describedBy}
                    value={recipientType ?? ''}
                    onValueChange={(v) => {
                      setRecipientType((v || null) as RecipientType | null);
                      setContact(null);
                      setConfirmDirect(false);
                    }}
                    placeholder="未選択"
                    options={allowedTypes.map((t) => ({ value: t, label: RECIPIENT_TYPE_LABEL[t] }))}
                  />
                )}
              </Field>
              {needsContact ? (
                <>
                  {!matter ? <Alert kind="info">案件を選ぶと、案件に登録済みの当事者・代理人が候補に出ます。</Alert> : null}
                  <ContactPicker
                    selectedId={contact?.id ?? null}
                    selectedLabel={contact ? `${contact.nameRaw}${contact.organizationNameRaw ? `（${contact.organizationNameRaw}）` : ''}` : undefined}
                    onSelect={(c) => {
                      setContact(c);
                      setConfirmDirect(false);
                    }}
                    onClear={() => setContact(null)}
                    suggestions={suggestions}
                    type={recipientType === 'opponent_agent' ? 'lawyer' : undefined}
                  />
                  {recipientType === 'opponent_agent' && matterDetail.data && suggestions.length === 0 ? <Alert kind="warning">この案件に相手方代理人が登録されていません。検索で選ぶ場合は、同一人物でもこの案件で代理する側を確認してください。</Alert> : null}
                </>
              ) : null}
              {opponentHasAgent ? (
                <Alert kind="warning" title="この相手方には代理人が登録されています">
                  <Checkbox checked={confirmDirect} onCheckedChange={setConfirmDirect} label="代理人がいますが本人宛てにします" description="可否はシステムが法的に判定しません。担当弁護士の判断で続行してください。" />
                </Alert>
              ) : null}
              {fieldErrors.recipientContactId ? <Alert kind="error">{fieldErrors.recipientContactId}</Alert> : null}
            </div>
          </section>
        ) : null}

        {show('summary') ? (
          <section className="band" aria-labelledby="h-summary">
            <h2 id="h-summary" style={{ marginBottom: 'var(--space-4)' }}>
              4. 不足の確認
            </h2>
            <dl className="dl">
              <dt>案件</dt>
              <dd>{matter ? matter.titleRaw : <span className="muted">未選択</span>}</dd>
              <dt>書式</dt>
              <dd>
                {tv.data ? (
                  <>
                    {tv.data ? templates.data?.find((t) => t.activeVersionId === tv.data?.id)?.name ?? templateKindLabel(tv.data.kind) : ''} <span className="aux muted num">版 {tv.data.revision}</span> {tv.data.sampleOnly ? <SampleOnlyBadge /> : <Badge tone="success">公開</Badge>}
                  </>
                ) : (
                  <span className="muted">未選択</span>
                )}
              </dd>
              <dt>宛先</dt>
              <dd>
                {recipientType ? RECIPIENT_TYPE_LABEL[recipientType] : <span className="muted">未選択</span>}
                {contact ? ` ／ ${contact.nameRaw}${contact.organizationNameRaw ? `（${contact.organizationNameRaw}）` : ''}` : ''}
              </dd>
            </dl>
            <div className="stack" style={{ marginTop: 'var(--space-4)' }}>
              <Field label="書類の表題（任意）" hint="空欄なら書式名から自動で付けます">
                {({ id, describedBy }) => <Input id={id} value={titleRaw} onValueChange={setTitleRaw} aria-describedby={describedBy} autoComplete="off" />}
              </Field>
              {gaps.map((g, i) => (
                <Alert key={i} kind={g.kind}>
                  {g.text}
                </Alert>
              ))}
              {blockers.length > 0 ? (
                <div className="notice-box">
                  <div className="row">
                    <Icon name="info" size={16} label="未完了" /> <b>進めるには:</b>
                  </div>
                  <ul style={{ paddingLeft: '1.2em', listStyle: 'disc' }}>
                    {blockers.map((b) => (
                      <li key={b}>{b}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {submitError ? (
                <Alert kind="error" live title="作成できませんでした">
                  {submitError} 入力内容は保持されています。
                </Alert>
              ) : null}
            </div>
          </section>
        ) : null}

        <div className={isMobile ? 'step-nav' : 'row'} style={!isMobile ? { justifyContent: 'flex-end' } : undefined}>
          {isMobile && idx > 0 ? (
            <Button onClick={() => setStep(STEPS[idx - 1] ?? 'matter')}>
              戻る
            </Button>
          ) : null}
          {isMobile && step !== 'summary' ? (
            <Button variant="primary" onClick={() => setStep(STEPS[idx + 1] ?? 'summary')} disabledReason={!stepDone[step] ? blockers[0] : undefined}>
              次へ
            </Button>
          ) : (
            <Button variant="primary" onClick={() => void submit()} busy={busy} disabledReason={!canSubmit ? blockers[0] : undefined} icon="portal">
              入力へ
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

/** 案件未登録のとき最小項目で登録して戻る */
function InlineMatterForm({ onCreated }: { onCreated: (m: MatterSummary) => void }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<MatterInput>({ titleRaw: '', caseNumberRaw: '', courtRaw: '', courtDepartmentRaw: '', scopeRaw: '' });
  const create = useCreateMatter();
  const errors = fieldErrorMap(create.error);
  if (!open) {
    return (
      <div style={{ marginTop: 'var(--space-3)' }}>
        <Button small icon="plus" onClick={() => setOpen(true)}>
          案件を登録（最小項目）
        </Button>
      </div>
    );
  }
  return (
    <form
      className="stack"
      style={{ marginTop: 'var(--space-4)', paddingTop: 'var(--space-4)', borderTop: 'var(--divider-width) solid var(--color-line)' }}
      onSubmit={(e) => {
        e.preventDefault();
        void create.mutateAsync(form).then((m) => onCreated(m)).catch(() => undefined);
      }}
      noValidate
    >
      <h3>案件を登録</h3>
      <Alert kind="info">当事者・代理人は登録後に案件画面から追加できます。氏名だけで人物を結合しません。</Alert>
      {create.isError ? (
        <Alert kind="error" live>
          {isApiError(create.error) ? create.error.userMessage() : '登録に失敗しました。'}
        </Alert>
      ) : null}
      <Field label="案件名" required error={errors.titleRaw}>
        {({ id, describedBy, invalid }) => <Input id={id} value={form.titleRaw} onValueChange={(v) => setForm({ ...form, titleRaw: v })} aria-describedby={describedBy} invalid={invalid} autoComplete="off" />}
      </Field>
      <div className="form-grid">
        <Field label="事件番号（原文）" error={errors.caseNumberRaw} hint="例: 令和８年（ワ）第１２３号。先頭の0や全角もそのまま保存">
          {({ id, describedBy, invalid }) => <Input id={id} value={form.caseNumberRaw ?? ''} onValueChange={(v) => setForm({ ...form, caseNumberRaw: v })} aria-describedby={describedBy} invalid={invalid} autoComplete="off" />}
        </Field>
        <Field label="裁判所" error={errors.courtRaw}>
          {({ id, describedBy, invalid }) => <Input id={id} value={form.courtRaw ?? ''} onValueChange={(v) => setForm({ ...form, courtRaw: v })} aria-describedby={describedBy} invalid={invalid} autoComplete="off" />}
        </Field>
      </div>
      <Field label="受任範囲" error={errors.scopeRaw}>
        {({ id, describedBy, invalid }) => <TextArea id={id} short value={form.scopeRaw ?? ''} onValueChange={(v) => setForm({ ...form, scopeRaw: v })} aria-describedby={describedBy} invalid={invalid} />}
      </Field>
      <div className="row">
        <Button type="submit" variant="primary" busy={create.isPending}>
          登録して選択
        </Button>
        <Button variant="quiet" onClick={() => setOpen(false)}>
          閉じる
        </Button>
      </div>
    </form>
  );
}
