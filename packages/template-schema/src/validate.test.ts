import { describe, expect, it } from 'vitest';
import { ConditionSchema, checkConditionLimits, evaluateCondition, type Condition } from './condition.js';
import { parseTemplateFieldSchema, validateFieldValues, validateTemplateSchema } from './validate.js';
import type { DiscoveredTag } from './validate.js';

const baseSchema = {
  schemaVersion: 1,
  kind: 'T01_engagement_notice',
  title: '受任通知',
  scope: 'negotiation',
  recipientTypes: ['opponent_agent'],
  fields: [
    { key: 'client_name', type: 'text', label: '依頼者', source: 'matter', sourcePath: 'client.name', required: true },
    { key: 'scope_text', type: 'multiline', label: '受任範囲', required: true },
    { key: 'has_deadline', type: 'boolean', label: '期限あり' },
    { key: 'deadline_raw', type: 'date', label: '期限', visibilityRule: { op: 'eq', field: 'has_deadline', value: true }, requiredRule: { op: 'eq', field: 'has_deadline', value: true } },
  ],
};

function tag(key: string, kind: DiscoveredTag['kind'] = 'value'): DiscoveredTag {
  return { raw: `{${kind === 'loop_open' ? '#' : kind === 'loop_close' ? '/' : ''}${key}}`, kind, key, valid: true, location: 'body/p1' };
}

describe('template schema validation', () => {
  it('parses a valid schema', () => {
    const r = parseTemplateFieldSchema(baseSchema);
    expect(r.schema).not.toBeNull();
  });
  it('reports undefined tags and unbalanced loops', () => {
    const { schema } = parseTemplateFieldSchema(baseSchema);
    const issues = validateTemplateSchema(schema!, [tag('client_name'), tag('scope_text'), tag('deadline_raw'), tag('unknown_key'), tag('rows', 'loop_open'), tag('body_text')]);
    expect(issues.find((i) => i.code === 'undefined_tag')?.tag).toBe('{unknown_key}');
    expect(issues.some((i) => i.code === 'unbalanced_loop')).toBe(true);
  });
  it('rejects dangerous keys at schema parse', () => {
    const bad = { ...baseSchema, fields: [{ key: '__proto__', type: 'text', label: 'x' }] };
    expect(parseTemplateFieldSchema(bad).schema).toBeNull();
  });
  it('detects rule cycles', () => {
    const cyc = {
      ...baseSchema,
      fields: [
        { key: 'a', type: 'text', label: 'a', visibilityRule: { op: 'isPresent', field: 'b' } },
        { key: 'b', type: 'text', label: 'b', visibilityRule: { op: 'isPresent', field: 'a' } },
      ],
    };
    const { schema } = parseTemplateFieldSchema(cyc);
    const issues = validateTemplateSchema(schema!, [tag('a'), tag('b'), tag('body_text')]);
    expect(issues.some((i) => i.code === 'rule_cycle')).toBe(true);
  });
  it('rejects defaults on legal-judgement fields', () => {
    const s = { ...baseSchema, fields: [{ key: 'admission', type: 'enum', label: '認否', legalJudgement: true, defaultPolicy: 'fixed', defaultValue: 'admit', options: [{ value: 'admit', label: '認める' }] }] };
    const { schema } = parseTemplateFieldSchema(s);
    expect(validateTemplateSchema(schema!, [tag('admission'), tag('body_text')]).some((i) => i.code === 'legal_judgement_default')).toBe(true);
  });
  it('validates values: required, conditional required, double honorific', () => {
    const { schema } = parseTemplateFieldSchema(baseSchema);
    const issues = validateFieldValues(schema!, { client_name: { rawValue: '山田太郎' }, scope_text: { rawValue: '' }, has_deadline: { rawValue: true } });
    expect(issues.map((i) => i.fieldKey)).toEqual(expect.arrayContaining(['scope_text', 'deadline_raw']));
    const h = validateFieldValues({ ...schema!, honorificKeys: ['client_name'] }, { client_name: { rawValue: '佐藤一郎先生' }, scope_text: { rawValue: 'x' } }, '先生');
    expect(h.some((i) => i.code === 'double_honorific')).toBe(true);
  });
});

describe('condition DSL', () => {
  it('evaluates eq/in/isPresent/and/or/not', () => {
    const c: Condition = { op: 'and', conditions: [{ op: 'eq', field: 'a', value: 'x' }, { op: 'not', condition: { op: 'isPresent', field: 'b' } }] };
    expect(evaluateCondition(c, { a: 'x' })).toBe(true);
    expect(evaluateCondition(c, { a: 'x', b: 'y' })).toBe(false);
    expect(evaluateCondition({ op: 'in', field: 'a', values: ['x', 'y'] }, { a: { rawValue: 'y' } })).toBe(true);
  });
  it('rejects free expressions and unknown ops', () => {
    expect(ConditionSchema.safeParse({ op: 'expr', code: '1+1' }).success).toBe(false);
    expect(ConditionSchema.safeParse({ op: 'eq', field: 'a.b', value: 1 }).success).toBe(false);
  });
  it('enforces depth 5', () => {
    let c: Condition = { op: 'isPresent', field: 'a' };
    for (let i = 0; i < 6; i++) c = { op: 'not', condition: c };
    expect(checkConditionLimits(c)?.code).toBe('condition_too_deep');
  });
});
