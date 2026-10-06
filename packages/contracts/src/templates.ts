import { z } from 'zod';
import { TemplateFieldSchemaSchema, TemplateKindSchema } from '@raylow/template-schema';
import { ExpectedVersionSchema, RawText, TemplateVersionStatusSchema, TimestampSchema, UuidSchema } from './common.js';

export const InspectionIssueSchema = z.object({
  severity: z.enum(['error', 'warning', 'info']),
  code: z.string(),
  message: z.string(),
  location: z.string().optional(),
  hint: z.string().optional(),
  tag: z.string().optional(),
  fieldKey: z.string().optional(),
});
export type InspectionIssue = z.infer<typeof InspectionIssueSchema>;

export const DiscoveredTagSchema = z.object({ raw: z.string(), kind: z.enum(['value', 'loop_open', 'loop_close', 'inverted_open']), key: z.string(), valid: z.boolean(), reason: z.string().optional(), location: z.string() });

export const InspectionReportSchema = z.object({
  ok: z.boolean(),
  issues: z.array(InspectionIssueSchema),
  tags: z.array(DiscoveredTagSchema),
  stats: z.record(z.unknown()).default({}),
  residualTextCandidates: z.array(z.object({ location: z.string(), text: z.string(), reason: z.string() })).default([]),
  inspectorVersion: z.string().optional(),
});
export type InspectionReport = z.infer<typeof InspectionReportSchema>;

export const TemplateVersionSchema = z.object({
  id: UuidSchema,
  templateId: UuidSchema,
  orgId: UuidSchema,
  revision: z.number().int(),
  docxFileId: UuidSchema,
  docxSha256: z.string(),
  fieldSchema: TemplateFieldSchemaSchema.nullable(),
  kind: z.string(),
  scope: z.string(),
  applicability: z.record(z.unknown()),
  sourceUrl: z.string().nullable(),
  checkedAt: z.string().nullable(),
  licenseNote: z.string().nullable(),
  status: TemplateVersionStatusSchema,
  sampleOnly: z.boolean(),
  approvedBy: UuidSchema.nullable(),
  approvedAt: TimestampSchema.nullable(),
  rendererProfileId: UuidSchema.nullable(),
  inspectionReport: InspectionReportSchema.nullable(),
  tagMap: z.record(z.string()),
  provenance: z.record(z.unknown()),
  createdAt: TimestampSchema,
  version: z.number().int(),
});
export type TemplateVersion = z.infer<typeof TemplateVersionSchema>;

export const TemplateSummarySchema = z.object({
  id: UuidSchema,
  orgId: UuidSchema,
  name: z.string(),
  kind: z.string(),
  activeVersionId: UuidSchema.nullable(),
  activeVersion: TemplateVersionSchema.pick({ id: true, revision: true, status: true, sampleOnly: true, scope: true, approvedBy: true, approvedAt: true }).nullable(),
  latestVersionStatus: TemplateVersionStatusSchema.nullable(),
  updatedAt: TimestampSchema,
  version: z.number().int(),
});
export type TemplateSummary = z.infer<typeof TemplateSummarySchema>;

export const TemplateListQuerySchema = z.object({ kind: TemplateKindSchema.optional(), status: TemplateVersionStatusSchema.optional(), scope: z.string().optional(), q: z.string().max(200).optional(), cursor: z.string().optional(), limit: z.coerce.number().int().min(1).max(100).default(100) });

/** POST /api/templates/import は multipart: file(docx) + fields(json) */
export const TemplateImportFieldsSchema = z.object({
  name: RawText(200).min(1),
  kind: TemplateKindSchema.default('custom'),
  scope: z.enum(['negotiation', 'client', 'court', 'internal']).default('negotiation'),
  /** 既存 template の新しい版として登録する場合 */
  templateId: UuidSchema.optional(),
  sourceUrl: z.string().url().max(2000).optional(),
  checkedAt: z.string().optional(),
  licenseNote: RawText(1000).optional(),
});
export const TemplateImportResponseSchema = z.object({ templateId: UuidSchema, versionId: UuidSchema, jobId: UuidSchema });

export const TemplateSchemaUpdateSchema = z.object({ expectedVersion: ExpectedVersionSchema, fieldSchema: TemplateFieldSchemaSchema, tagMap: z.record(z.string()).default({}), rendererProfileId: UuidSchema.nullable().optional() });
export const TemplateTestRequestSchema = z.object({ sampleValues: z.record(z.unknown()).optional() });
export const TemplatePublishSchema = z.object({
  expectedVersion: ExpectedVersionSchema,
  confirmations: z.object({
    contentReviewed: z.literal(true),
    residualTextReviewed: z.literal(true),
    applicabilityReviewed: z.literal(true),
  }),
  /** 所内書式版として承認する場合 false。sample_only=true は正式利用不可 */
  sampleOnly: z.boolean(),
  applicability: z.record(z.unknown()).optional(),
  sourceUrl: z.string().url().max(2000).nullable().optional(),
  checkedAt: z.string().nullable().optional(),
  licenseNote: RawText(1000).nullable().optional(),
});
export const TemplateRetireSchema = z.object({ expectedVersion: ExpectedVersionSchema, reasonRaw: RawText(500).optional() });

export const PhraseVersionSchema = z.object({ id: UuidSchema, phraseId: UuidSchema, revision: z.number().int(), bodyRaw: z.string(), status: z.enum(['draft', 'pending_approval', 'approved', 'retired']), approvedBy: UuidSchema.nullable(), approvedAt: TimestampSchema.nullable(), createdAt: TimestampSchema });
export const PhraseSchema = z.object({ id: UuidSchema, orgId: UuidSchema, title: z.string(), category: z.string(), templateKind: z.string().nullable(), currentVersion: PhraseVersionSchema.nullable(), versions: z.array(PhraseVersionSchema).optional(), updatedAt: TimestampSchema, version: z.number().int() });
export type Phrase = z.infer<typeof PhraseSchema>;
export const PhraseInputSchema = z.object({ title: RawText(200).min(1), category: RawText(100).default(''), templateKind: TemplateKindSchema.nullable().optional(), bodyRaw: RawText(20000).min(1) });
export const PhraseVersionInputSchema = z.object({ bodyRaw: RawText(20000).min(1), requestApproval: z.boolean().default(false) });
export const PhraseApproveSchema = z.object({ confirmations: z.object({ contentReviewed: z.literal(true), residualTextReviewed: z.literal(true) }) });

export const RendererProfileSchema = z.object({ id: UuidSchema, orgId: UuidSchema.nullable(), name: z.string(), settings: z.record(z.unknown()), version: z.number().int() });
export const CourtProfileSchema = z.object({ id: UuidSchema, orgId: UuidSchema.nullable(), version: z.number().int(), name: z.string(), sourceUrl: z.string().nullable(), checkedAt: z.string().nullable(), applicableProcedure: z.string(), fileRules: z.record(z.unknown()), pageRules: z.record(z.unknown()), namingRules: z.record(z.unknown()) });
