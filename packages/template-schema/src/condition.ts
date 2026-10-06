/**
 * 条件 DSL（§5.3）: eq / in / isPresent / and / or / not のみ。深さ 5・項数 100 上限。自由式禁止。
 */
import { z } from 'zod';
import { isSafeTagKey } from './tags.js';

export type Condition =
  | { op: 'eq'; field: string; value: string | number | boolean }
  | { op: 'in'; field: string; values: Array<string | number | boolean> }
  | { op: 'isPresent'; field: string }
  | { op: 'and'; conditions: Condition[] }
  | { op: 'or'; conditions: Condition[] }
  | { op: 'not'; condition: Condition };

const scalar = z.union([z.string().max(1000), z.number().finite(), z.boolean()]);
const fieldKey = z.string().refine(isSafeTagKey, 'field key not allowed');

export const ConditionSchema: z.ZodType<Condition> = z.lazy(() =>
  z.discriminatedUnion('op', [
    z.object({ op: z.literal('eq'), field: fieldKey, value: scalar }).strict(),
    z.object({ op: z.literal('in'), field: fieldKey, values: z.array(scalar).max(100) }).strict(),
    z.object({ op: z.literal('isPresent'), field: fieldKey }).strict(),
    z.object({ op: z.literal('and'), conditions: z.array(ConditionSchema).min(1).max(100) }).strict(),
    z.object({ op: z.literal('or'), conditions: z.array(ConditionSchema).min(1).max(100) }).strict(),
    z.object({ op: z.literal('not'), condition: ConditionSchema }).strict(),
  ]),
);

export const CONDITION_MAX_DEPTH = 5;
export const CONDITION_MAX_TERMS = 100;

export function conditionDepth(c: Condition): number {
  switch (c.op) {
    case 'and':
    case 'or':
      return 1 + Math.max(0, ...c.conditions.map(conditionDepth));
    case 'not':
      return 1 + conditionDepth(c.condition);
    default:
      return 1;
  }
}

export function conditionTerms(c: Condition): number {
  switch (c.op) {
    case 'and':
    case 'or':
      return 1 + c.conditions.reduce((n, x) => n + conditionTerms(x), 0);
    case 'not':
      return 1 + conditionTerms(c.condition);
    default:
      return 1;
  }
}

export function conditionFields(c: Condition, out: Set<string> = new Set()): Set<string> {
  switch (c.op) {
    case 'and':
    case 'or':
      c.conditions.forEach((x) => conditionFields(x, out));
      break;
    case 'not':
      conditionFields(c.condition, out);
      break;
    default:
      out.add(c.field);
  }
  return out;
}

export interface ConditionLimitError {
  code: 'condition_too_deep' | 'condition_too_many_terms';
  value: number;
  limit: number;
}

export function checkConditionLimits(c: Condition): ConditionLimitError | null {
  const d = conditionDepth(c);
  if (d > CONDITION_MAX_DEPTH) return { code: 'condition_too_deep', value: d, limit: CONDITION_MAX_DEPTH };
  const t = conditionTerms(c);
  if (t > CONDITION_MAX_TERMS) return { code: 'condition_too_many_terms', value: t, limit: CONDITION_MAX_TERMS };
  return null;
}

export type FieldValueMap = Record<string, unknown>;

function isPresent(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === 'string') return v.length > 0;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'object') {
    const o = v as { raw?: unknown; rawValue?: unknown };
    if ('rawValue' in o) return isPresent(o.rawValue);
    if ('raw' in o) return isPresent(o.raw);
    return Object.keys(o).length > 0;
  }
  return true;
}

function scalarOf(v: unknown): unknown {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const o = v as { rawValue?: unknown; raw?: unknown; value?: unknown };
    if ('rawValue' in o) return o.rawValue;
    if ('value' in o) return o.value;
    if ('raw' in o) return o.raw;
  }
  return v;
}

/** 評価。自由式を実行しない。 */
export function evaluateCondition(c: Condition, values: FieldValueMap): boolean {
  switch (c.op) {
    case 'eq':
      return scalarOf(values[c.field]) === c.value;
    case 'in':
      return c.values.includes(scalarOf(values[c.field]) as string | number | boolean);
    case 'isPresent':
      return isPresent(values[c.field]);
    case 'and':
      return c.conditions.every((x) => evaluateCondition(x, values));
    case 'or':
      return c.conditions.some((x) => evaluateCondition(x, values));
    case 'not':
      return !evaluateCondition(c.condition, values);
  }
}
