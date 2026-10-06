/**
 * FieldSpec（§5.3）
 * FieldSpec={key,type,label,source,required,defaultPolicy,maxGraphemes,options,visibilityRule,validationRules,outputFormat}
 */
import { z } from 'zod';
import { ConditionSchema } from './condition.js';
import { isSafeTagKey } from './tags.js';

export const FieldTypeSchema = z.enum(['text', 'multiline', 'date', 'enum', 'boolean', 'personRef', 'partyRef', 'money', 'array']);
export type FieldType = z.infer<typeof FieldTypeSchema>;

export const FieldSourceSchema = z.enum(['office', 'matter', 'recipient', 'input']);
export type FieldSource = z.infer<typeof FieldSourceSchema>;

export const DefaultPolicySchema = z.enum(['none', 'from_source', 'today', 'fixed']);

export const ValidationRuleSchema = z.discriminatedUnion('rule', [
  z.object({ rule: z.literal('maxGraphemes'), value: z.number().int().positive() }).strict(),
  z.object({ rule: z.literal('minGraphemes'), value: z.number().int().nonnegative() }).strict(),
  z.object({ rule: z.literal('pattern'), value: z.string().max(200), message: z.string().max(200).optional() }).strict(),
  z.object({ rule: z.literal('noDoubleHonorific') }).strict(),
  z.object({ rule: z.literal('isoDateOrRaw') }).strict(),
  z.object({ rule: z.literal('jpyInteger') }).strict(),
]);
export type ValidationRule = z.infer<typeof ValidationRuleSchema>;

export const OutputFormatSchema = z.enum(['plain', 'wareki', 'iso_date', 'jpy_grouped', 'multiline', 'list_lines']);

const keySchema = z.string().refine(isSafeTagKey, { message: 'key must match ^[a-z][a-z0-9_]{0,63}$ and not be a dangerous key' });

export const ArrayItemFieldSchema = z
  .object({
    key: keySchema,
    type: z.enum(['text', 'multiline', 'date', 'enum', 'boolean', 'money']),
    label: z.string().min(1).max(100),
    required: z.boolean().default(false),
    options: z.array(z.object({ value: z.string().max(100), label: z.string().max(100) })).max(100).optional(),
    maxGraphemes: z.number().int().positive().optional(),
  })
  .strict();
export type ArrayItemField = z.infer<typeof ArrayItemFieldSchema>;

export const FieldSpecSchema = z
  .object({
    key: keySchema,
    type: FieldTypeSchema,
    label: z.string().min(1).max(100),
    description: z.string().max(500).optional(),
    source: FieldSourceSchema.default('input'),
    /** source が office/matter/recipient のとき、どの属性から差し込むか */
    sourcePath: z.string().max(100).optional(),
    required: z.boolean().default(false),
    defaultPolicy: DefaultPolicySchema.default('none'),
    defaultValue: z.string().max(2000).optional(),
    maxGraphemes: z.number().int().positive().optional(),
    options: z.array(z.object({ value: z.string().max(100), label: z.string().max(100) })).max(100).optional(),
    visibilityRule: ConditionSchema.optional(),
    /** required を条件付きにする（visibilityRule とは別） */
    requiredRule: ConditionSchema.optional(),
    validationRules: z.array(ValidationRuleSchema).max(20).default([]),
    outputFormat: OutputFormatSchema.default('plain'),
    /** type=array のときの行スキーマ */
    itemFields: z.array(ArrayItemFieldSchema).min(1).max(30).optional(),
    maxItems: z.number().int().positive().max(500).optional(),
    /** 法的判断を含む項目は既定値を置かない（例: 認否・特別授権）。UI が強調表示する */
    legalJudgement: z.boolean().default(false),
  })
  .strict();
export type FieldSpec = z.infer<typeof FieldSpecSchema>;
export type FieldSpecInput = z.input<typeof FieldSpecSchema>;

export const TemplateKindSchema = z.enum([
  'T01_engagement_notice',
  'T02_reply_letter',
  'T03_inquiry_letter',
  'T04_document_request',
  'T05_demand_letter',
  'T06_settlement_proposal',
  'T07_agreement',
  'T08_cover_letter',
  'T09_client_progress_report',
  'T10_retainer_agreement',
  'T11_power_of_attorney_litigation',
  'T12_complaint',
  'T13_answer',
  'T14_brief',
  'T15_party_list',
  'T16_evidence_description',
  'T17_electronic_evidence_description',
  'T18_documentary_evidence_submission',
  'T19_withdrawal_of_action',
  'T20_termination_of_engagement',
  'custom',
]);
export type TemplateKind = z.infer<typeof TemplateKindSchema>;

export const TemplateScopeSchema = z.enum(['negotiation', 'client', 'court', 'internal']);

export const TemplateFieldSchemaSchema = z
  .object({
    schemaVersion: z.literal(1),
    kind: TemplateKindSchema,
    title: z.string().min(1).max(200),
    scope: TemplateScopeSchema,
    /** 宛先種別の許容 */
    recipientTypes: z.array(z.enum(['opponent_agent', 'opponent', 'client', 'court', 'third_party', 'none'])).min(1),
    fields: z.array(FieldSpecSchema).min(1).max(200),
    /** 本文 AST を差し込むタグ。省略時は body_text */
    bodyTag: z.string().refine(isSafeTagKey).default('body_text'),
    /** 添付リストを使うか */
    attachments: z.boolean().default(true),
    /** 二重敬称の検査対象キー */
    honorificKeys: z.array(keySchema).default(['recipient_name']),
    notes: z.string().max(2000).optional(),
  })
  .strict();
export type TemplateFieldSchema = z.infer<typeof TemplateFieldSchemaSchema>;
export type TemplateFieldSchemaInput = z.input<typeof TemplateFieldSchemaSchema>;
