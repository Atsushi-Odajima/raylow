import { z } from 'zod';
import { DocumentASTSchema, FieldValuesSchema } from '@raylow/template-schema';
import { DraftStatusSchema, ExpectedVersionSchema, JobStateSchema, RawText, RecipientTypeSchema, TimestampSchema, UuidSchema } from './common.js';

export const AttachmentSchema = z.object({ name: RawText(200), copies: RawText(20).default('') });

export const RecipientSnapshotSchema = z.object({
  type: RecipientTypeSchema,
  contactId: UuidSchema.nullable(),
  contactVersion: z.number().int().nullable(),
  nameRaw: z.string(),
  organizationNameRaw: z.string(),
  addressRaw: z.string(),
  postcodeRaw: z.string(),
  honorific: z.string(),
  /** 相手方本人宛てで代理人がいる場合の確認 */
  confirmedDirectToOpponent: z.boolean().optional(),
});
export type RecipientSnapshot = z.infer<typeof RecipientSnapshotSchema>;

export const DraftSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  fields: FieldValuesSchema,
  recipient: RecipientSnapshotSchema,
  attachments: z.array(AttachmentSchema).default([]),
  /** snapshot した各マスターの版 */
  sources: z.object({
    officeProfileId: UuidSchema.nullable(),
    officeProfileRevision: z.number().int().nullable(),
    matterVersion: z.number().int(),
    lawyerId: UuidSchema.nullable(),
    lawyerVersion: z.number().int().nullable(),
    templateVersionId: UuidSchema,
    phraseVersionIds: z.array(UuidSchema).default([]),
  }),
  issueDate: z.string().nullable(),
});
export type DraftSnapshot = z.infer<typeof DraftSnapshotSchema>;

export const PreflightIssueSchema = z.object({
  severity: z.enum(['error', 'warning', 'confirm']),
  category: z.enum(['required', 'identity_mismatch', 'unreplaced_tag', 'template_unapproved', 'evidence', 'font', 'layout', 'recipient_mixing', 'metadata', 'honorific', 'other']),
  code: z.string(),
  message: z.string(),
  fieldKey: z.string().optional(),
  blockId: z.string().optional(),
  location: z.string().optional(),
  /** 形式検査であり法的審査ではない */
  kind: z.literal('formal').default('formal'),
});
export type PreflightIssue = z.infer<typeof PreflightIssueSchema>;

export const PreflightReportSchema = z.object({
  issues: z.array(PreflightIssueSchema),
  blocking: z.boolean(),
  confirmationsRequired: z.array(z.string()),
  generatedAt: TimestampSchema,
  /** 法的審査は別。システムは「法的問題なし」と総合判定しない */
  legalReviewNote: z.string().default('この検査は形式検査です。法的内容の確認は担当弁護士が行います。'),
});
export type PreflightReport = z.infer<typeof PreflightReportSchema>;

export const DraftOutputSchema = z.object({
  id: UuidSchema,
  revisionId: UuidSchema,
  format: z.enum(['docx', 'pdf']),
  mode: z.enum(['draft', 'final']),
  fileId: UuidSchema,
  sha256: z.string(),
  rendererVersion: z.string(),
  fontManifest: z.array(z.unknown()),
  status: z.enum(['ready', 'failed', 'superseded']),
  createdAt: TimestampSchema,
});
export type DraftOutput = z.infer<typeof DraftOutputSchema>;

export const DraftRevisionSchema = z.object({
  id: UuidSchema,
  draftId: UuidSchema,
  revision: z.number().int(),
  templateVersionId: UuidSchema,
  snapshot: DraftSnapshotSchema,
  ast: DocumentASTSchema,
  sourceRevisionId: UuidSchema.nullable(),
  kind: z.enum(['app', 'external_edit']),
  externalFileVersionId: UuidSchema.nullable(),
  hash: z.string(),
  createdAt: TimestampSchema,
  createdBy: UuidSchema.nullable(),
  createdByName: z.string().nullable(),
});
export type DraftRevision = z.infer<typeof DraftRevisionSchema>;

export const EditLeaseSchema = z.object({ draftId: UuidSchema, userId: UuidSchema, userName: z.string(), expiresAt: TimestampSchema, mine: z.boolean() });

export const DraftSchema = z.object({
  id: UuidSchema,
  orgId: UuidSchema,
  matterId: UuidSchema,
  matterTitleRaw: z.string(),
  templateId: UuidSchema,
  templateName: z.string(),
  kind: z.string(),
  titleRaw: z.string(),
  status: DraftStatusSchema,
  recipientType: RecipientTypeSchema,
  recipientContactId: UuidSchema.nullable(),
  currentRevisionId: UuidSchema.nullable(),
  approvedRevisionId: UuidSchema.nullable(),
  batchId: UuidSchema.nullable(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  version: z.number().int(),
});
export type Draft = z.infer<typeof DraftSchema>;

export const DraftDetailSchema = z.object({
  draft: DraftSchema,
  currentRevision: DraftRevisionSchema.nullable(),
  approvedRevision: DraftRevisionSchema.nullable(),
  outputs: z.array(DraftOutputSchema),
  lease: EditLeaseSchema.nullable(),
  preflight: PreflightReportSchema.nullable(),
  templateVersion: z.object({ id: UuidSchema, revision: z.number().int(), status: z.string(), sampleOnly: z.boolean(), fieldSchema: z.unknown(), templateName: z.string() }),
  pendingJobs: z.array(z.object({ id: UuidSchema, type: z.string(), state: JobStateSchema, progress: z.record(z.unknown()) })),
  openReviewId: UuidSchema.nullable(),
  canEdit: z.boolean(),
  canApprove: z.boolean(),
});
export type DraftDetail = z.infer<typeof DraftDetailSchema>;

export const DraftCreateSchema = z.object({
  matterId: UuidSchema,
  templateVersionId: UuidSchema,
  recipientType: RecipientTypeSchema,
  recipientContactId: UuidSchema.nullable().optional(),
  /** 相手方代理人がいるのに本人宛てにする場合の確認（システムは可否を判定しない） */
  confirmDirectToOpponent: z.boolean().optional(),
  idempotencyKey: z.string().min(8).max(100),
  titleRaw: RawText(300).optional(),
});
export const DraftRevisionInputSchema = z.object({
  expectedVersion: ExpectedVersionSchema,
  fields: FieldValuesSchema,
  ast: DocumentASTSchema,
  attachments: z.array(AttachmentSchema).default([]),
  issueDate: z.string().nullable().optional(),
  phraseVersionIds: z.array(UuidSchema).optional(),
});
export const DraftLeaseRequestSchema = z.object({ takeoverReason: RawText(500).optional() });
export const RefreshCandidateSchema = z.object({
  fieldKey: z.string(),
  label: z.string(),
  currentValue: z.string(),
  newValue: z.string(),
  sourceKind: z.enum(['office', 'matter', 'recipient', 'lawyer', 'phrase']),
  sourceId: z.string().nullable(),
  sourceVersion: z.number().int().nullable(),
  manuallyOverridden: z.boolean(),
});
export const RefreshCandidatesResponseSchema = z.object({ candidates: z.array(RefreshCandidateSchema) });
export const ApplyCandidatesSchema = z.object({ expectedVersion: ExpectedVersionSchema, fieldKeys: z.array(z.string()).min(1) });
export const RenderRequestSchema = z.object({ mode: z.enum(['draft', 'final']).default('draft') });
export const RenderResponseSchema = z.object({ jobId: UuidSchema, deduplicated: z.boolean() });
export const ReviewRequestCreateSchema = z.object({ reviewerId: UuidSchema, note: RawText(1000).optional() });
export const DraftListQuerySchema = z.object({
  matterId: UuidSchema.optional(),
  kind: z.string().optional(),
  status: DraftStatusSchema.optional(),
  q: z.string().max(200).optional(),
  mine: z.coerce.boolean().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
