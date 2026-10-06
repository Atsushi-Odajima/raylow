/**
 * S02 /setup: 差出人必須情報 → 所内ユーザー（弁護士） → 確認。PC は最大 800px のフォーム、mobile は段階式。
 */
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import type { OfficeProfile } from '@raylow/contracts';
import { useCreateLawyer, useLawyers, useMembers, useOffices, useSaveOffice, useUpdateLawyer, type LawyerInput, type OfficeProfileInput } from '../api/masters';
import { fieldErrorMap, isApiError } from '../lib/apiClient';
import { useIsMobile } from '../hooks/useMediaQuery';
import { Alert } from '../components/Alert';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { Checkbox } from '../components/Checkbox';
import { Field } from '../components/Field';
import { Input } from '../components/Input';
import { PageHeader } from '../components/PageHeader';
import { Select } from '../components/Select';
import { Stepper } from '../components/Stepper';
import { ErrorState, LoadingState } from '../components/States';
import { VersionConflictDialog } from '../components/VersionConflictDialog';
import { unsavedRegistry } from '../lib/unsaved';
import { useSyncExternalStore } from 'react';
import { sessionStore } from '../lib/session';

type StepKey = 'office' | 'lawyers' | 'confirm';

const EMPTY_OFFICE: OfficeProfileInput = { nameRaw: '', addressRaw: '', postcodeRaw: '', phoneRaw: '', faxRaw: '', emailRaw: '', signatureSettings: {}, honorificSettings: { person: '様', lawyer: '先生', organization: '御中', court: '御中' } };

function toInput(o: OfficeProfile): OfficeProfileInput {
  return { nameRaw: o.nameRaw, addressRaw: o.addressRaw, postcodeRaw: o.postcodeRaw, phoneRaw: o.phoneRaw, faxRaw: o.faxRaw, emailRaw: o.emailRaw, signatureSettings: o.signatureSettings, honorificSettings: o.honorificSettings };
}

export function SetupPage() {
  const isMobile = useIsMobile();
  const [step, setStep] = useState<StepKey>('office');
  const offices = useOffices();
  const current = useMemo(() => offices.data?.find((o) => o.isCurrent) ?? offices.data?.[0] ?? null, [offices.data]);

  return (
    <div className="container">
      <PageHeader title="事務所・弁護士の設定" lead="書類の差出人になる事務所情報と所属弁護士を登録します。保存すると新しい版（revision）になり、過去に確定した書面は変わりません。" crumbs={[{ to: '/create', label: '作成' }, { label: '初期設定' }]} />
      {isMobile ? (
        <div style={{ marginBottom: 'var(--space-4)' }}>
          <Stepper
            label="設定の工程"
            current={step}
            onSelect={setStep}
            steps={[
              { key: 'office', label: '差出人情報', done: !!current?.nameRaw },
              { key: 'lawyers', label: '所属弁護士' },
              { key: 'confirm', label: '確認' },
            ]}
          />
        </div>
      ) : null}
      <div className="form-800 stack-l">
        {offices.isLoading ? <LoadingState /> : null}
        {offices.isError ? <ErrorState error={offices.error} onRetry={() => void offices.refetch()} /> : null}
        {offices.isSuccess && (!isMobile || step === 'office') ? <OfficeSection current={current} onSaved={() => isMobile && setStep('lawyers')} /> : null}
        {!isMobile || step === 'lawyers' ? <LawyersSection onNext={() => isMobile && setStep('confirm')} /> : null}
        {!isMobile || step === 'confirm' ? <ConfirmSection current={current} /> : null}
      </div>
    </div>
  );
}

function OfficeSection({ current, onSaved }: { current: OfficeProfile | null; onSaved: () => void }) {
  const [form, setForm] = useState<OfficeProfileInput>(() => (current ? toInput(current) : EMPTY_OFFICE));
  const [dirty, setDirty] = useState(false);
  const save = useSaveOffice();
  const [conflict, setConflict] = useState<number | null>(null);
  const errors = fieldErrorMap(save.error);
  useEffect(() => {
    if (current && !dirty) setForm(toInput(current));
  }, [current, dirty]);
  useEffect(() => {
    unsavedRegistry.set('setup-office', dirty);
    return () => unsavedRegistry.clear('setup-office');
  }, [dirty]);

  const set = <K extends keyof OfficeProfileInput>(k: K, v: OfficeProfileInput[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setDirty(true);
  };
  const hon = form.honorificSettings ?? EMPTY_OFFICE.honorificSettings!;
  const setHon = (k: keyof typeof hon, v: string) => set('honorificSettings', { ...hon, [k]: v });

  const submit = async () => {
    try {
      await save.mutateAsync({ id: current?.id ?? null, input: form, expectedVersion: current?.version ?? null });
      setDirty(false);
      onSaved();
    } catch (e) {
      if (isApiError(e) && e.isConflict) setConflict(e.currentVersion);
      else if (isApiError(e) && e.isValidation) {
        const first = e.fieldErrors[0]?.field;
        if (first) document.getElementById(`office-${first}`)?.focus();
      }
    }
  };

  return (
    <section className="band" aria-labelledby="h-office">
      <h2 id="h-office" style={{ marginBottom: 'var(--space-4)' }}>
        差出人情報（事務所）
      </h2>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        noValidate
      >
        {save.isError && !isApiError(save.error) ? <Alert kind="error">保存に失敗しました。</Alert> : null}
        {save.isError && isApiError(save.error) && !save.error.isConflict ? (
          <Alert kind="error" live title="保存できませんでした">
            {save.error.userMessage()} 入力は保持されています。
          </Alert>
        ) : null}
        {save.isSuccess && !dirty ? (
          <Alert kind="success" live>
            事務所情報を保存しました（新しい版）。
          </Alert>
        ) : null}
        <Field label="事務所名" required error={errors.nameRaw}>
          {({ id, describedBy, invalid }) => <Input id={id} value={form.nameRaw} onValueChange={(v) => set('nameRaw', v)} aria-describedby={describedBy} invalid={invalid} autoComplete="organization" />}
        </Field>
        <div className="form-grid">
          <Field label="郵便番号" error={errors.postcodeRaw} hint="原文のまま保存します（全角・ハイフン等を変換しません）">
            {({ id, describedBy, invalid }) => <Input id={id} value={form.postcodeRaw ?? ''} onValueChange={(v) => set('postcodeRaw', v)} aria-describedby={describedBy} invalid={invalid} autoComplete="postal-code" />}
          </Field>
          <Field label="住所" required error={errors.addressRaw} className="span-all">
            {({ id, describedBy, invalid }) => <Input id={id} value={form.addressRaw ?? ''} onValueChange={(v) => set('addressRaw', v)} aria-describedby={describedBy} invalid={invalid} autoComplete="street-address" />}
          </Field>
          <Field label="電話" error={errors.phoneRaw}>
            {({ id, describedBy, invalid }) => <Input id={id} value={form.phoneRaw ?? ''} onValueChange={(v) => set('phoneRaw', v)} aria-describedby={describedBy} invalid={invalid} autoComplete="tel" />}
          </Field>
          <Field label="FAX" error={errors.faxRaw}>
            {({ id, describedBy, invalid }) => <Input id={id} value={form.faxRaw ?? ''} onValueChange={(v) => set('faxRaw', v)} aria-describedby={describedBy} invalid={invalid} />}
          </Field>
          <Field label="メール" error={errors.emailRaw} className="span-all">
            {({ id, describedBy, invalid }) => <Input id={id} value={form.emailRaw ?? ''} onValueChange={(v) => set('emailRaw', v)} aria-describedby={describedBy} invalid={invalid} autoComplete="email" />}
          </Field>
        </div>
        <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="field__label">宛名の敬称（二重敬称を検出します）</legend>
          <div className="form-grid">
            <Field label="個人">{({ id }) => <Input id={id} value={hon.person} onValueChange={(v) => setHon('person', v)} />}</Field>
            <Field label="弁護士">{({ id }) => <Input id={id} value={hon.lawyer} onValueChange={(v) => setHon('lawyer', v)} />}</Field>
            <Field label="法人・団体">{({ id }) => <Input id={id} value={hon.organization} onValueChange={(v) => setHon('organization', v)} />}</Field>
            <Field label="裁判所">{({ id }) => <Input id={id} value={hon.court} onValueChange={(v) => setHon('court', v)} />}</Field>
          </div>
        </fieldset>
        <div className="row-between">
          <span className="aux muted">{current ? `現在の版: ${current.revision}` : '未登録'}</span>
          <Button type="submit" variant="primary" busy={save.isPending} disabledReason={!dirty && !!current ? '変更がありません' : undefined}>
            保存（新しい版）
          </Button>
        </div>
      </form>
      <VersionConflictDialog open={conflict != null} currentVersion={conflict} myVersion={current?.version ?? 0} onReload={() => window.location.reload()} onClose={() => setConflict(null)} />
    </section>
  );
}

function LawyersSection({ onNext }: { onNext: () => void }) {
  const session = useSyncExternalStore(sessionStore.subscribe.bind(sessionStore), sessionStore.getState.bind(sessionStore), sessionStore.getState.bind(sessionStore));
  const lawyers = useLawyers();
  const members = useMembers(session.info?.role === 'admin' || session.info?.role === 'lawyer');
  const create = useCreateLawyer();
  const update = useUpdateLawyer();
  const [form, setForm] = useState<LawyerInput>({ nameRaw: '', kana: '', titleRaw: '弁護士', registrationNumberRaw: '', userId: null });
  const errors = fieldErrorMap(create.error);
  const submit = async () => {
    await create.mutateAsync(form).catch(() => undefined);
    if (!create.isError) setForm({ nameRaw: '', kana: '', titleRaw: '弁護士', registrationNumberRaw: '', userId: null });
  };
  return (
    <section className="band" aria-labelledby="h-lawyers">
      <h2 id="h-lawyers" style={{ marginBottom: 'var(--space-4)' }}>
        所属弁護士
      </h2>
      <Alert kind="info">運用は弁護士 2 名以上を前提とします（最終編集者とは別の弁護士が承認します）。所内ユーザーの追加・権限は <Link to="/settings">設定</Link> で行います。</Alert>
      {lawyers.isLoading ? <LoadingState /> : null}
      {lawyers.isError ? <ErrorState error={lawyers.error} onRetry={() => void lawyers.refetch()} /> : null}
      {lawyers.data ? (
        <ul className="rowlist" style={{ marginTop: 'var(--space-4)' }}>
          {lawyers.data.length === 0 ? <li className="rowlist__item muted">弁護士が登録されていません。下のフォームから登録してください。</li> : null}
          {lawyers.data.map((l) => (
            <li key={l.id} className="rowlist__item">
              <div className="rowlist__main">
                <div className="rowlist__title">
                  {l.nameRaw} <span className="aux muted">{l.kana}</span>
                </div>
                <div className="rowlist__meta">
                  <span>{l.titleRaw}</span>
                  {l.registrationNumberRaw ? <span>登録番号 {l.registrationNumberRaw}</span> : null}
                  <span>{l.userId ? 'ユーザー紐付けあり' : 'ユーザー未紐付け'}</span>
                  <Badge tone={l.active ? 'success' : 'muted'}>{l.active ? '在籍' : '無効'}</Badge>
                </div>
              </div>
              <div className="rowlist__actions">
                <Button small onClick={() => update.mutate({ id: l.id, patch: { active: !l.active }, expectedVersion: l.version })} busy={update.isPending}>
                  {l.active ? '無効にする' : '有効にする'}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
      <form
        className="stack"
        style={{ marginTop: 'var(--space-5)' }}
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        noValidate
      >
        <h3>弁護士を追加</h3>
        {create.isError ? (
          <Alert kind="error" live>
            {isApiError(create.error) ? create.error.userMessage() : '登録に失敗しました。'}
          </Alert>
        ) : null}
        <div className="form-grid">
          <Field label="氏名" required error={errors.nameRaw}>
            {({ id, describedBy, invalid }) => <Input id={id} value={form.nameRaw} onValueChange={(v) => setForm({ ...form, nameRaw: v })} aria-describedby={describedBy} invalid={invalid} autoComplete="off" />}
          </Field>
          <Field label="かな" error={errors.kana}>
            {({ id, describedBy, invalid }) => <Input id={id} value={form.kana ?? ''} onValueChange={(v) => setForm({ ...form, kana: v })} aria-describedby={describedBy} invalid={invalid} autoComplete="off" />}
          </Field>
          <Field label="肩書" error={errors.titleRaw}>
            {({ id, describedBy, invalid }) => <Input id={id} value={form.titleRaw ?? ''} onValueChange={(v) => setForm({ ...form, titleRaw: v })} aria-describedby={describedBy} invalid={invalid} />}
          </Field>
          <Field label="登録番号（原文）" error={errors.registrationNumberRaw}>
            {({ id, describedBy, invalid }) => <Input id={id} value={form.registrationNumberRaw ?? ''} onValueChange={(v) => setForm({ ...form, registrationNumberRaw: v })} aria-describedby={describedBy} invalid={invalid} autoComplete="off" />}
          </Field>
          {members.data ? (
            <Field label="所内ユーザーとの紐付け" hint="承認権限はユーザーに紐付いた弁護士のみ" className="span-all">
              {({ id }) => (
                <Select
                  id={id}
                  value={form.userId ?? ''}
                  onValueChange={(v) => setForm({ ...form, userId: v || null })}
                  placeholder="紐付けなし"
                  options={members.data.filter((m) => m.role === 'lawyer' && m.status === 'active').map((m) => ({ value: m.userId, label: `${m.displayName}（${m.email}）` }))}
                />
              )}
            </Field>
          ) : null}
        </div>
        <div className="row-between">
          <Button type="submit" variant="primary" busy={create.isPending}>
            弁護士を登録
          </Button>
          <Button variant="quiet" onClick={onNext}>
            次へ
          </Button>
        </div>
      </form>
    </section>
  );
}

function ConfirmSection({ current }: { current: OfficeProfile | null }) {
  const lawyers = useLawyers();
  const ok = !!current?.nameRaw && !!current.addressRaw && (lawyers.data?.filter((l) => l.active).length ?? 0) > 0;
  const [ack, setAck] = useState(false);
  return (
    <section className="band" aria-labelledby="h-confirm">
      <h2 id="h-confirm" style={{ marginBottom: 'var(--space-4)' }}>
        確認
      </h2>
      <dl className="dl">
        <dt>事務所名</dt>
        <dd>{current?.nameRaw || <span className="muted">未登録</span>}</dd>
        <dt>住所</dt>
        <dd>{current ? `${current.postcodeRaw} ${current.addressRaw}`.trim() || <span className="muted">未登録</span> : <span className="muted">未登録</span>}</dd>
        <dt>連絡先</dt>
        <dd>{current ? [current.phoneRaw && `電話 ${current.phoneRaw}`, current.faxRaw && `FAX ${current.faxRaw}`, current.emailRaw].filter(Boolean).join(' ／ ') || '—' : '—'}</dd>
        <dt>在籍弁護士</dt>
        <dd className="num">{lawyers.data ? `${lawyers.data.filter((l) => l.active).length} 名` : '…'}</dd>
      </dl>
      <div style={{ marginTop: 'var(--space-4)' }} className="stack">
        {ok ? <Alert kind="success">書類作成に必要な差出人情報が揃っています。</Alert> : <Alert kind="warning">事務所名・住所・在籍弁護士 1 名以上が必要です。未入力の項目へ戻って登録してください。</Alert>}
        <Checkbox checked={ack} onCheckedChange={setAck} label="登録内容を確認しました" />
        <div>
          <Link to="/create" className={['btn btn-primary', ok && ack ? '' : 'btn-disabled'].join(' ').trim()} aria-disabled={!(ok && ack)} onClick={(e) => (!(ok && ack) ? e.preventDefault() : undefined)} title={!(ok && ack) ? '必要な登録と確認が済んでいません' : undefined}>
            作成画面へ
          </Link>
          {!(ok && ack) ? <div className="aux muted">必要な登録と確認チェックが済むと進めます</div> : null}
        </div>
      </div>
    </section>
  );
}
