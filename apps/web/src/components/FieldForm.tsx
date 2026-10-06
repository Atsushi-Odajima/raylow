/**
 * templateVersion.fieldSchema（FieldSpec[]）から入力フォームを生成する。
 * - visibilityRule は evaluateCondition（isFieldVisible）で評価
 * - text は制御入力で rawValue をそのまま保持。money/date は raw と parse 候補を並記し raw を上書きしない
 * - inputMode numeric を本文/事件番号/人名へ使わない
 * - 不可視文字は警告のみ（自動削除しない）
 * - legalJudgement:true は「弁護士判断」バッジ、既定選択なし
 * - array は編集可能な行
 */
import { useMemo, type ReactNode } from 'react';
import { isFieldRequired, isFieldVisible, type ArrayItemField, type FieldSpec, type FieldValue, type FieldValues, type TemplateFieldSchema } from '@raylow/template-schema';
import { findInvisible, parseJapaneseDate, parseMoneyJpy } from '@raylow/japanese-text';
import type { MatterDetail } from '@raylow/contracts';
import { PARTY_ROLE_LABEL } from '../lib/labels';
import { Badge, LegalJudgementBadge } from './Badge';
import { Button } from './Button';
import { RadioGroup } from './Checkbox';
import { Field } from './Field';
import { Icon } from './Icon';
import { Input } from './Input';
import { Select } from './Select';
import { TextArea } from './TextArea';
import { ContactPicker } from './ContactPicker';

export interface FieldFormProps {
  schema: TemplateFieldSchema;
  values: FieldValues;
  onChange: (key: string, value: FieldValue) => void;
  fieldErrors?: Record<string, string> | undefined;
  disabled?: boolean | undefined;
  disabledReason?: string | undefined;
  matter?: MatterDetail | null | undefined;
  /** 強調表示する項目（S06 から戻ってきたとき） */
  focusKey?: string | null | undefined;
}

const SOURCE_LABEL: Record<string, string> = { office: '自事務所', matter: '案件', recipient: '宛先', input: '入力' };

function rawString(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (typeof v === 'object') {
    const o = v as { raw?: unknown; rawValue?: unknown; displayValue?: unknown };
    if (typeof o.raw === 'string') return o.raw;
    if (typeof o.rawValue === 'string') return o.rawValue;
    if (typeof o.displayValue === 'string') return o.displayValue;
  }
  return '';
}

function invisibleWarning(text: string): string | undefined {
  const found = findInvisible(text);
  if (found.length === 0) return undefined;
  const head = found.slice(0, 3).map((f) => `${f.codePoint}（${f.description}）`).join('、');
  return `不可視文字・制御文字が ${found.length} 件含まれています: ${head}${found.length > 3 ? ' ほか' : ''}。自動では削除しません。`;
}

export function FieldForm({ schema, values, onChange, fieldErrors, disabled, disabledReason, matter, focusKey }: FieldFormProps) {
  const visible = useMemo(() => schema.fields.filter((f) => isFieldVisible(f, values)), [schema.fields, values]);
  return (
    <div className="stack">
      {disabledReason ? (
        <div className="notice-box aux">
          <Icon name="lock" size={16} label="編集不可" /> {disabledReason}
        </div>
      ) : null}
      {visible.map((f) => (
        <FieldInput
          key={f.key}
          spec={f}
          value={values[f.key]}
          required={isFieldRequired(f, values)}
          error={fieldErrors?.[f.key]}
          disabled={disabled}
          matter={matter}
          highlighted={focusKey === f.key}
          onChange={(v) => {
            const prev = values[f.key];
            const next: FieldValue = {
              rawValue: v.rawValue,
              ...(v.displayValue !== undefined ? { displayValue: v.displayValue } : {}),
              ...(prev?.sourceId !== undefined ? { sourceId: prev.sourceId } : {}),
              ...(prev?.sourceVersion !== undefined ? { sourceVersion: prev.sourceVersion } : {}),
              // 差込元のある項目を手入力で変えたら manuallyOverridden（再差込で消さない）
              ...(f.source !== 'input' ? { manuallyOverridden: true } : prev?.manuallyOverridden !== undefined ? { manuallyOverridden: prev.manuallyOverridden } : {}),
            };
            onChange(f.key, next);
          }}
        />
      ))}
    </div>
  );
}

interface FieldInputProps {
  spec: FieldSpec;
  value: FieldValue | undefined;
  required: boolean;
  error?: string | undefined;
  disabled?: boolean | undefined;
  matter?: MatterDetail | null | undefined;
  highlighted?: boolean | undefined;
  onChange: (v: { rawValue: unknown; displayValue?: string }) => void;
}

function FieldInput({ spec, value, required, error, disabled, matter, highlighted, onChange }: FieldInputProps) {
  const raw = rawString(value?.rawValue);
  const adornment = (
    <>
      {spec.legalJudgement ? <LegalJudgementBadge /> : null}
      {spec.source !== 'input' ? (
        <Badge tone={value?.manuallyOverridden ? 'warning' : 'muted'} icon="merge">
          {SOURCE_LABEL[spec.source] ?? spec.source}から差込{value?.manuallyOverridden ? '（手入力で上書き）' : ''}
        </Badge>
      ) : null}
    </>
  );
  const hint = spec.description;
  const invisible = typeof raw === 'string' ? invisibleWarning(raw) : undefined;
  const wrapperStyle = highlighted ? { outline: 'var(--focus-ring)', outlineOffset: '6px' } : undefined;
  const inputId = `field-${spec.key}`;

  const wrap = (children: (ids: { id: string; describedBy: string | undefined; invalid: boolean }) => ReactNode, extraWarning?: string | undefined) => (
    <div style={wrapperStyle} id={inputId} data-field-key={spec.key}>
      <Field label={spec.label} required={required} hint={hint} error={error} warning={extraWarning ?? invisible} adornment={adornment}>
        {children}
      </Field>
    </div>
  );

  switch (spec.type) {
    case 'text':
      return wrap(({ id, describedBy, invalid }) => (
        <Input id={id} value={raw} onValueChange={(v) => onChange({ rawValue: v })} aria-describedby={describedBy} invalid={invalid} disabled={disabled} autoComplete="off" spellCheck={false} />
      ));
    case 'multiline':
      return wrap(({ id, describedBy, invalid }) => <TextArea id={id} value={raw} onValueChange={(v) => onChange({ rawValue: v })} aria-describedby={describedBy} invalid={invalid} disabled={disabled} spellCheck={false} />);
    case 'date': {
      const parsed = raw ? parseJapaneseDate(raw) : null;
      const warn = parsed?.needsConfirmation ? `日付の解釈に確認が必要です（${parsed.warnings.join(', ') || '未解析'}）。原文はそのまま保存されます。` : undefined;
      return wrap(
        ({ id, describedBy, invalid }) => (
          <>
            <Input
              id={id}
              value={raw}
              onValueChange={(v) => {
                const p = parseJapaneseDate(v);
                onChange({ rawValue: { raw: v, iso: p.iso, precision: p.precision, approximate: p.approximate } });
              }}
              aria-describedby={describedBy}
              invalid={invalid}
              disabled={disabled}
              placeholder="例: 令和8年10月6日 / 2026-10-06"
              autoComplete="off"
            />
            {parsed ? (
              <div className="parsed-candidate" aria-live="polite">
                解析候補: <strong>{parsed.iso ?? '解析できません'}</strong>
                {parsed.precision !== 'unknown' ? `（精度: ${parsed.precision}${parsed.approximate ? '・概ね' : ''}）` : ''}
                {parsed.era ? ` / ${parsed.era.name}${parsed.era.eraYearRaw}年` : ''}
                <span> — 原文「{raw}」は変更されません</span>
              </div>
            ) : null}
          </>
        ),
        warn ?? invisible,
      );
    }
    case 'money': {
      const parsed = raw ? parseMoneyJpy(raw) : null;
      const warn = parsed && parsed.decimal == null ? `金額として解析できません（${parsed.warnings.join(', ')}）。原文はそのまま保存されます。利息・遅延損害金は自動計算しません。` : undefined;
      return wrap(
        ({ id, describedBy, invalid }) => (
          <>
            <Input
              id={id}
              value={raw}
              onValueChange={(v) => {
                const p = parseMoneyJpy(v);
                onChange({ rawValue: { raw: v, decimal: p.decimal, currency: 'JPY' } });
              }}
              aria-describedby={describedBy}
              invalid={invalid}
              disabled={disabled}
              placeholder="例: 1,500,000円 / １５０万円（原文を保持）"
              autoComplete="off"
            />
            {parsed ? (
              <div className="parsed-candidate" aria-live="polite">
                解析候補（JPY 整数）: <strong className="num">{parsed.decimal != null ? `${Number(parsed.decimal).toLocaleString('ja-JP')} 円` : '—'}</strong>
                <span> — 原文「{raw}」は変更されません</span>
              </div>
            ) : null}
          </>
        ),
        warn ?? invisible,
      );
    }
    case 'enum': {
      const opts = (spec.options ?? []).map((o) => ({ value: o.value, label: o.label }));
      return wrap(({ id, describedBy, invalid }) => (
        <Select id={id} value={typeof value?.rawValue === 'string' ? value.rawValue : ''} onValueChange={(v) => onChange({ rawValue: v })} options={opts} placeholder={spec.legalJudgement ? '未選択（弁護士が選択）' : '未選択'} aria-describedby={describedBy} invalid={invalid} disabled={disabled} />
      ));
    }
    case 'boolean': {
      const cur = typeof value?.rawValue === 'boolean' ? (value.rawValue ? 'true' : 'false') : null;
      return (
        <div style={wrapperStyle} id={inputId} data-field-key={spec.key}>
          <RadioGroup
            name={`f-${spec.key}`}
            legend={
              <>
                {spec.label}
                {required ? <span className="field__required">必須</span> : null} {adornment}
              </>
            }
            value={cur}
            onValueChange={(v) => onChange({ rawValue: v === 'true' })}
            options={[
              { value: 'true', label: 'はい' },
              { value: 'false', label: 'いいえ' },
            ]}
            disabled={disabled}
          />
          {spec.legalJudgement ? <div className="inline-note">既定値はありません。担当弁護士が選択します。</div> : null}
          {hint ? <div className="field__hint">{hint}</div> : null}
          {error ? (
            <div className="field__error" role="alert">
              <Icon name="alert" size={16} label="エラー" /> {error}
            </div>
          ) : null}
        </div>
      );
    }
    case 'partyRef': {
      const parties = matter?.parties ?? [];
      const opts = parties.map((p) => ({ value: p.contactId, label: `${p.contact.nameRaw}（${PARTY_ROLE_LABEL[p.role] ?? p.role}${p.contact.organizationNameRaw ? '・' + p.contact.organizationNameRaw : ''}）` }));
      const current = typeof value?.rawValue === 'string' ? value.rawValue : rawString(value?.rawValue);
      const matched = parties.find((p) => p.contactId === current);
      return wrap(({ id, describedBy, invalid }) => (
        <>
          {opts.length > 0 ? (
            <Select
              id={id}
              value={matched ? current : ''}
              onValueChange={(v) => {
                const p = parties.find((x) => x.contactId === v);
                onChange({ rawValue: v, ...(p ? { displayValue: p.contact.nameRaw } : {}) });
              }}
              options={opts}
              placeholder="案件の当事者から選択"
              aria-describedby={describedBy}
              invalid={invalid}
              disabled={disabled}
            />
          ) : (
            <Input id={id} value={rawString(value?.displayValue ?? value?.rawValue)} onValueChange={(v) => onChange({ rawValue: v, displayValue: v })} aria-describedby={describedBy} invalid={invalid} disabled={disabled} />
          )}
          {value?.displayValue ? <div className="parsed-candidate">表示値: {value.displayValue}（氏名の一致だけで置換しません）</div> : null}
        </>
      ));
    }
    case 'personRef': {
      return wrap(({ id, describedBy }) => (
        <ContactPicker
          id={id}
          describedBy={describedBy}
          selectedId={typeof value?.rawValue === 'string' && /^[0-9a-f-]{36}$/i.test(value.rawValue) ? value.rawValue : null}
          selectedLabel={value?.displayValue ?? (typeof value?.rawValue === 'string' && !/^[0-9a-f-]{36}$/i.test(value.rawValue) ? value.rawValue : '')}
          onSelect={(c) => onChange({ rawValue: c.id, displayValue: c.nameRaw })}
          disabled={disabled}
        />
      ));
    }
    case 'array':
      return (
        <div style={wrapperStyle} id={inputId} data-field-key={spec.key}>
          <ArrayField spec={spec} value={value} required={required} error={error} disabled={disabled} onChange={onChange} adornment={adornment} />
        </div>
      );
  }
}

function ArrayField({ spec, value, required, error, disabled, onChange, adornment }: Omit<FieldInputProps, 'matter' | 'highlighted'> & { adornment: ReactNode }) {
  const rows: Array<Record<string, unknown>> = Array.isArray(value?.rawValue) ? (value.rawValue as Array<Record<string, unknown>>) : [];
  const items: ArrayItemField[] = spec.itemFields ?? [];
  const setRows = (next: Array<Record<string, unknown>>) => onChange({ rawValue: next });
  const update = (idx: number, key: string, v: unknown) => {
    const next = rows.map((r, i) => (i === idx ? { ...r, [key]: v } : r));
    setRows(next);
  };
  const canAdd = !spec.maxItems || rows.length < spec.maxItems;
  return (
    <div className="field">
      <div className="field__label">
        <span>{spec.label}</span>
        {required ? <span className="field__required">必須</span> : null}
        {adornment}
        <span className="inline-note num">
          {rows.length} 行{spec.maxItems ? ` / 上限 ${spec.maxItems}` : ''}
        </span>
      </div>
      {spec.description ? <div className="field__hint">{spec.description}</div> : null}
      <div className="array-rows">
        {rows.map((row, idx) => (
          <div key={idx} className="array-row" role="group" aria-label={`${spec.label} ${idx + 1} 行目`}>
            {items.map((it) => (
              <ArrayCell key={it.key} item={it} value={row[it.key]} disabled={disabled} onChange={(v) => update(idx, it.key, v)} />
            ))}
            <div className="array-row__tools">
              <Button small variant="quiet" aria-label={`${idx + 1} 行目を上へ`} onClick={() => idx > 0 && setRows(swap(rows, idx, idx - 1))} disabledReason={disabled ? '編集不可' : idx === 0 ? '先頭です' : undefined}>
                <Icon name="arrow-up" size={16} />
              </Button>
              <Button small variant="quiet" aria-label={`${idx + 1} 行目を下へ`} onClick={() => idx < rows.length - 1 && setRows(swap(rows, idx, idx + 1))} disabledReason={disabled ? '編集不可' : idx === rows.length - 1 ? '末尾です' : undefined}>
                <Icon name="arrow-down" size={16} />
              </Button>
              <Button small variant="quiet" aria-label={`${idx + 1} 行目を削除`} onClick={() => setRows(rows.filter((_, i) => i !== idx))} disabledReason={disabled ? '編集不可' : undefined}>
                <Icon name="close" size={16} />
              </Button>
            </div>
          </div>
        ))}
      </div>
      <div>
        <Button small icon="plus" onClick={() => setRows([...rows, Object.fromEntries(items.map((it) => [it.key, it.type === 'boolean' ? false : '']))])} disabledReason={disabled ? '編集不可' : !canAdd ? `上限 ${spec.maxItems} 行に達しています` : undefined}>
          行を追加
        </Button>
      </div>
      {error ? (
        <div className="field__error" role="alert">
          <Icon name="alert" size={16} label="エラー" /> {error}
        </div>
      ) : null}
    </div>
  );
}

function swap<T>(arr: T[], a: number, b: number): T[] {
  const next = [...arr];
  const x = next[a];
  const y = next[b];
  if (x === undefined || y === undefined) return arr;
  next[a] = y;
  next[b] = x;
  return next;
}

function ArrayCell({ item, value, disabled, onChange }: { item: ArrayItemField; value: unknown; disabled: boolean | undefined; onChange: (v: unknown) => void }) {
  const raw = rawString(value);
  const label = (
    <>
      {item.label}
      {item.required ? <span className="field__required">必須</span> : null}
    </>
  );
  if (item.type === 'boolean') {
    return (
      <label className="check">
        <input type="checkbox" checked={value === true} disabled={disabled} onChange={(e) => onChange(e.currentTarget.checked)} />
        <span className="check__text">{label}</span>
      </label>
    );
  }
  if (item.type === 'enum') {
    return (
      <Field label={label}>
        {({ id }) => <Select id={id} value={typeof value === 'string' ? value : ''} onValueChange={onChange} options={(item.options ?? []).map((o) => ({ value: o.value, label: o.label }))} placeholder="未選択" disabled={disabled} />}
      </Field>
    );
  }
  if (item.type === 'multiline') {
    return <Field label={label}>{({ id }) => <TextArea id={id} short value={raw} onValueChange={onChange} disabled={disabled} />}</Field>;
  }
  if (item.type === 'money') {
    const p = raw ? parseMoneyJpy(raw) : null;
    return (
      <Field label={label} hint={p ? `解析候補: ${p.decimal != null ? Number(p.decimal).toLocaleString('ja-JP') + ' 円' : '—'}` : undefined}>
        {({ id }) => <Input id={id} value={raw} onValueChange={(v) => onChange({ raw: v, decimal: parseMoneyJpy(v).decimal, currency: 'JPY' })} disabled={disabled} />}
      </Field>
    );
  }
  if (item.type === 'date') {
    const p = raw ? parseJapaneseDate(raw) : null;
    return (
      <Field label={label} hint={p ? `解析候補: ${p.iso ?? '—'}` : undefined}>
        {({ id }) => <Input id={id} value={raw} onValueChange={(v) => onChange({ raw: v, iso: parseJapaneseDate(v).iso, precision: parseJapaneseDate(v).precision })} disabled={disabled} />}
      </Field>
    );
  }
  return <Field label={label}>{({ id }) => <Input id={id} value={raw} onValueChange={onChange} disabled={disabled} autoComplete="off" />}</Field>;
}
