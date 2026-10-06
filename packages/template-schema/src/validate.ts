/**
 * 書式スキーマの登録時検査（§5.3 / AC06）
 *  - 必須項目の欠落
 *  - 非表示条件と必須条件の循環
 *  - 未定義タグ（DOCX にあるがスキーマに無い）
 *  - 未使用フィールド（警告）
 *  - 条件 DSL の深さ・項数
 *  - 危険キー
 */
import { z } from 'zod';
import { graphemeLength } from '@raylow/japanese-text';
import { checkConditionLimits, conditionFields, evaluateCondition, type Condition } from './condition.js';
import { FieldSpecSchema, TemplateFieldSchemaSchema, type FieldSpec, type TemplateFieldSchema } from './fieldSpec.js';
import { COMMON_TAG_KEYS, isSafeTagKey, type ParsedTag } from './tags.js';

export interface SchemaIssue {
  severity: 'error' | 'warning';
  code: string;
  message: string;
  fieldKey?: string;
  tag?: string;
  location?: string;
}

export interface DiscoveredTag extends ParsedTag {
  location: string;
}

/** システム側が常に供給するキー（スキーマで定義しなくても未定義タグにならない） */
export const SYSTEM_SUPPLIED_KEYS = new Set<string>([
  'document_status_label',
  'template_version_label',
  'matter_id',
  'issue_date',
  'issue_date_wareki',
  'body_text',
  'body_blocks',
  'text',
  'number_label',
  'is_heading',
  'is_numbered',
  'is_paragraph',
  'has_attachments',
  'attachments',
  'name',
  'copies',
  'office_name',
  'office_address',
  'office_postcode',
  'office_phone',
  'office_fax',
  'office_email',
  'lawyer_name',
  'lawyer_title',
  'matter_title',
  'recipient_name',
  'recipient_honorific',
  'recipient_organization',
  'recipient_address',
  'client_name',
  'opponent_name',
  'subject',
]);

export function parseTemplateFieldSchema(input: unknown): { schema: TemplateFieldSchema | null; issues: SchemaIssue[] } {
  const r = TemplateFieldSchemaSchema.safeParse(input);
  if (!r.success) {
    return {
      schema: null,
      issues: r.error.issues.map((i): SchemaIssue => {
        const fk = i.path[1];
        const base: SchemaIssue = { severity: 'error', code: 'schema_invalid', message: `${i.path.join('.')}: ${i.message}` };
        return typeof fk === 'number' ? { ...base, location: `fields[${fk}]` } : base;
      }),
    };
  }
  return { schema: r.data, issues: [] };
}

export function validateTemplateSchema(schema: TemplateFieldSchema, discoveredTags: DiscoveredTag[]): SchemaIssue[] {
  const issues: SchemaIssue[] = [];
  const keys = new Map<string, FieldSpec>();
  for (const f of schema.fields) {
    if (keys.has(f.key)) issues.push({ severity: 'error', code: 'duplicate_field_key', message: `フィールドキー重複: ${f.key}`, fieldKey: f.key });
    keys.set(f.key, f);
    if (!isSafeTagKey(f.key)) issues.push({ severity: 'error', code: 'dangerous_key', message: `許可されないキー: ${f.key}`, fieldKey: f.key });
    if (f.type === 'enum' && (!f.options || f.options.length === 0)) issues.push({ severity: 'error', code: 'enum_without_options', message: `enum に options がありません: ${f.key}`, fieldKey: f.key });
    if (f.type === 'array' && (!f.itemFields || f.itemFields.length === 0)) issues.push({ severity: 'error', code: 'array_without_item_fields', message: `array に itemFields がありません: ${f.key}`, fieldKey: f.key });
    if (f.type !== 'array' && f.itemFields) issues.push({ severity: 'error', code: 'item_fields_on_non_array', message: `array 以外に itemFields: ${f.key}`, fieldKey: f.key });
    if (f.source !== 'input' && !f.sourcePath) issues.push({ severity: 'error', code: 'source_without_path', message: `source=${f.source} には sourcePath が必要: ${f.key}`, fieldKey: f.key });
    if (f.legalJudgement && f.defaultPolicy !== 'none') issues.push({ severity: 'error', code: 'legal_judgement_default', message: `法的判断を含む項目に既定値を置けません: ${f.key}`, fieldKey: f.key });
    for (const cond of [f.visibilityRule, f.requiredRule]) {
      if (!cond) continue;
      const lim = checkConditionLimits(cond);
      if (lim) issues.push({ severity: 'error', code: lim.code, message: `${f.key}: 条件が上限超過 (${lim.value} > ${lim.limit})`, fieldKey: f.key });
    }
  }
  // 条件が参照するフィールドの存在
  for (const f of schema.fields) {
    for (const cond of [f.visibilityRule, f.requiredRule]) {
      if (!cond) continue;
      for (const ref of conditionFields(cond)) {
        if (!keys.has(ref)) issues.push({ severity: 'error', code: 'condition_unknown_field', message: `${f.key} の条件が未定義フィールド ${ref} を参照`, fieldKey: f.key });
      }
    }
  }
  // 非表示条件と必須条件の循環
  const cycles = findRuleCycles(schema.fields);
  for (const c of cycles) issues.push({ severity: 'error', code: 'rule_cycle', message: `条件の循環: ${c.join(' -> ')}`, fieldKey: c[0] ?? '' });

  // タグ側の検査
  const loopStack: DiscoveredTag[] = [];
  const tagKeys = new Set<string>();
  for (const t of discoveredTags) {
    if (!t.valid) {
      issues.push({ severity: 'error', code: t.reason ?? 'invalid_tag', message: `無効なタグ ${t.raw}（${t.reason}）`, tag: t.raw, location: t.location });
      continue;
    }
    if (t.kind === 'loop_open' || t.kind === 'inverted_open') loopStack.push(t);
    else if (t.kind === 'loop_close') {
      const open = loopStack.pop();
      if (!open || open.key !== t.key) issues.push({ severity: 'error', code: 'unbalanced_loop', message: `対応しないループ終了 ${t.raw}`, tag: t.raw, location: t.location });
    }
    tagKeys.add(t.key);
  }
  for (const open of loopStack) issues.push({ severity: 'error', code: 'unbalanced_loop', message: `閉じられていないループ ${open.raw}`, tag: open.raw, location: open.location });

  const arrayItemKeys = new Set<string>();
  for (const f of schema.fields) if (f.type === 'array') for (const it of f.itemFields ?? []) arrayItemKeys.add(it.key);

  for (const t of discoveredTags) {
    if (!t.valid) continue;
    const k = t.key;
    if (keys.has(k) || SYSTEM_SUPPLIED_KEYS.has(k) || arrayItemKeys.has(k) || k === schema.bodyTag) continue;
    issues.push({ severity: 'error', code: 'undefined_tag', message: `スキーマに未定義のタグ ${t.raw}`, tag: t.raw, location: t.location });
  }
  for (const f of schema.fields) {
    if (!tagKeys.has(f.key) && f.type !== 'array') {
      issues.push({ severity: 'warning', code: 'unused_field', message: `フィールド ${f.key} を使うタグが DOCX にありません`, fieldKey: f.key });
    }
  }
  // bodyTag の存在
  if (!tagKeys.has(schema.bodyTag) && !tagKeys.has('body_blocks')) {
    issues.push({ severity: 'warning', code: 'body_tag_missing', message: `本文タグ {${schema.bodyTag}} または {#body_blocks} が DOCX にありません` });
  }
  return issues;
}

/** visibilityRule/requiredRule の参照グラフで循環を探す */
export function findRuleCycles(fields: FieldSpec[]): string[][] {
  const graph = new Map<string, Set<string>>();
  for (const f of fields) {
    const deps = new Set<string>();
    if (f.visibilityRule) for (const d of conditionFields(f.visibilityRule)) deps.add(d);
    if (f.requiredRule) for (const d of conditionFields(f.requiredRule)) deps.add(d);
    graph.set(f.key, deps);
  }
  const cycles: string[][] = [];
  const state = new Map<string, 'visiting' | 'done'>();
  const stack: string[] = [];
  const visit = (k: string): void => {
    const st = state.get(k);
    if (st === 'done') return;
    if (st === 'visiting') {
      const idx = stack.indexOf(k);
      cycles.push([...stack.slice(idx), k]);
      return;
    }
    state.set(k, 'visiting');
    stack.push(k);
    for (const d of graph.get(k) ?? []) if (graph.has(d)) visit(d);
    stack.pop();
    state.set(k, 'done');
  };
  for (const k of graph.keys()) visit(k);
  return cycles;
}

/* ---------------- 入力値の検査 ---------------- */

export interface FieldValue {
  rawValue: unknown;
  displayValue?: string;
  sourceId?: string | null;
  sourceVersion?: number | null;
  manuallyOverridden?: boolean;
}

export type FieldValues = Record<string, FieldValue>;

export interface ValueIssue {
  severity: 'error' | 'warning';
  code: string;
  fieldKey: string;
  message: string;
}

const HONORIFICS = ['先生', '様', '殿', '御中', 'さん', '氏'];

function rawOf(v: FieldValue | undefined): unknown {
  return v?.rawValue;
}

function toFlat(values: FieldValues): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(values)) o[k] = v.rawValue;
  return o;
}

export function isFieldVisible(f: FieldSpec, values: FieldValues): boolean {
  if (!f.visibilityRule) return true;
  return evaluateCondition(f.visibilityRule as Condition, toFlat(values));
}

export function isFieldRequired(f: FieldSpec, values: FieldValues): boolean {
  if (f.requiredRule) return evaluateCondition(f.requiredRule as Condition, toFlat(values));
  return f.required;
}

export function validateFieldValues(schema: TemplateFieldSchema, values: FieldValues, honorific?: string): ValueIssue[] {
  const issues: ValueIssue[] = [];
  for (const f of schema.fields) {
    if (!isFieldVisible(f, values)) continue;
    const raw = rawOf(values[f.key]);
    const present = raw !== undefined && raw !== null && !(typeof raw === 'string' && raw.length === 0) && !(Array.isArray(raw) && raw.length === 0);
    if (isFieldRequired(f, values) && !present) {
      issues.push({ severity: 'error', code: 'required_missing', fieldKey: f.key, message: `${f.label} が未入力です` });
      continue;
    }
    if (!present) continue;
    if (typeof raw === 'string') {
      const max = f.maxGraphemes;
      if (max && graphemeLength(raw) > max) issues.push({ severity: 'warning', code: 'max_graphemes_exceeded', fieldKey: f.key, message: `${f.label} が ${max} 文字を超えています（縮小や省略は自動で行いません）` });
      if (f.type === 'enum' && f.options && !f.options.some((o) => o.value === raw)) issues.push({ severity: 'error', code: 'enum_value_invalid', fieldKey: f.key, message: `${f.label} の選択値が不正です` });
      for (const r of f.validationRules) {
        if (r.rule === 'pattern') {
          let ok = true;
          try {
            ok = new RegExp(r.value, 'u').test(raw);
          } catch {
            ok = true;
          }
          if (!ok) issues.push({ severity: 'error', code: 'pattern_mismatch', fieldKey: f.key, message: r.message ?? `${f.label} の形式が不正です` });
        }
        if (r.rule === 'maxGraphemes' && graphemeLength(raw) > r.value) issues.push({ severity: 'warning', code: 'max_graphemes_exceeded', fieldKey: f.key, message: `${f.label} が ${r.value} 文字を超えています` });
        if (r.rule === 'minGraphemes' && graphemeLength(raw) < r.value) issues.push({ severity: 'error', code: 'min_graphemes', fieldKey: f.key, message: `${f.label} が短すぎます` });
      }
    }
    if (f.type === 'array' && Array.isArray(raw)) {
      if (f.maxItems && raw.length > f.maxItems) issues.push({ severity: 'error', code: 'too_many_items', fieldKey: f.key, message: `${f.label} の行数が上限 ${f.maxItems} を超えています` });
      raw.forEach((row, idx) => {
        if (!row || typeof row !== 'object') {
          issues.push({ severity: 'error', code: 'array_row_invalid', fieldKey: f.key, message: `${f.label} ${idx + 1} 行目が不正です` });
          return;
        }
        for (const it of f.itemFields ?? []) {
          const v = (row as Record<string, unknown>)[it.key];
          const p = v !== undefined && v !== null && !(typeof v === 'string' && v.length === 0);
          if (it.required && !p) issues.push({ severity: 'error', code: 'required_missing', fieldKey: `${f.key}[${idx}].${it.key}`, message: `${f.label} ${idx + 1} 行目の ${it.label} が未入力です` });
        }
      });
    }
    if (f.type === 'boolean' && typeof raw !== 'boolean') issues.push({ severity: 'error', code: 'boolean_invalid', fieldKey: f.key, message: `${f.label} は true/false で指定します` });
  }
  // 二重敬称: 宛名に敬称が含まれ、かつ所内設定の敬称を付加する場合
  if (honorific) {
    for (const k of schema.honorificKeys) {
      const raw = rawOf(values[k]);
      if (typeof raw === 'string' && HONORIFICS.some((h) => raw.endsWith(h))) {
        issues.push({ severity: 'warning', code: 'double_honorific', fieldKey: k, message: `宛名「${raw}」に敬称が含まれており、敬称「${honorific}」と二重になります（値は変更しません）` });
      }
    }
  }
  return issues;
}

export const FieldValueSchema = z
  .object({
    rawValue: z.unknown(),
    displayValue: z.string().max(50000).optional(),
    sourceId: z.string().nullable().optional(),
    sourceVersion: z.number().int().nullable().optional(),
    manuallyOverridden: z.boolean().optional(),
  })
  .strict();
export const FieldValuesSchema = z.record(z.string().refine(isSafeTagKey), FieldValueSchema);

export { FieldSpecSchema };
