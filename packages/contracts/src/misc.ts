import { z } from 'zod';
import { RawText, TimestampSchema, UuidSchema } from './common.js';

export const AuditEventSchema = z.object({
  id: UuidSchema,
  orgId: UuidSchema,
  matterId: UuidSchema.nullable(),
  actorId: UuidSchema.nullable(),
  actorName: z.string().nullable(),
  actorRole: z.string().nullable(),
  action: z.string(),
  targetType: z.string(),
  targetId: UuidSchema.nullable(),
  targetVersion: z.number().int().nullable(),
  targetHash: z.string().nullable(),
  requestId: z.string().nullable(),
  details: z.record(z.unknown()),
  createdAt: TimestampSchema,
});
export type AuditEvent = z.infer<typeof AuditEventSchema>;
export const AuditQuerySchema = z.object({ matterId: UuidSchema.optional(), action: z.string().optional(), cursor: z.string().optional(), limit: z.coerce.number().int().min(1).max(100).default(50) });

export const ExportRequestSchema = z.object({
  type: z.enum(['matter_json', 'evidence_csv', 'audit_csv', 'contacts_csv', 'matters_csv', 'full_backup']),
  matterId: UuidSchema.optional(),
  encoding: z.enum(['utf8_bom', 'cp932']).default('utf8_bom'),
});
export const ExportResponseSchema = z.object({ jobId: UuidSchema });

export const ImportKindSchema = z.enum(['contacts', 'matters', 'matter_parties']);
export const ImportPreviewRequestSchema = z.object({ kind: ImportKindSchema, encoding: z.enum(['utf8', 'utf8_bom', 'cp932', 'auto']).default('auto') });
export const ImportRowErrorSchema = z.object({ row: z.number().int(), column: z.string().nullable(), code: z.string(), message: z.string() });
export const ImportPreviewResponseSchema = z.object({
  importToken: z.string(),
  kind: ImportKindSchema,
  detectedEncoding: z.string(),
  totalRows: z.number().int(),
  previewRows: z.array(z.record(z.string())).max(20),
  errors: z.array(ImportRowErrorSchema),
  canCommit: z.boolean(),
});
export const ImportCommitSchema = z.object({ importToken: z.string() });
export const ImportCommitResponseSchema = z.object({ inserted: z.number().int(), updated: z.number().int() });

export const SearchQuerySchema = z.object({ q: z.string().min(1).max(200), mode: z.enum(['normalized', 'exact']).default('normalized'), limit: z.coerce.number().int().min(1).max(50).default(20) });
export const SearchResultSchema = z.object({
  contacts: z.array(z.object({ id: UuidSchema, nameRaw: z.string(), organizationNameRaw: z.string(), addressRaw: z.string(), matchReason: z.string(), quote: z.string() })),
  matters: z.array(z.object({ id: UuidSchema, titleRaw: z.string(), caseNumberRaw: z.string(), matchReason: z.string(), quote: z.string() })),
  documents: z.array(z.object({ id: UuidSchema, titleRaw: z.string(), kind: z.string(), status: z.string(), matterId: UuidSchema, matchReason: z.string(), quote: z.string() })),
});

export const OrgSettingsSchema = z.object({
  name: z.string(),
  retentionYears: z.number().int().nullable(),
  autoDeleteEnabled: z.boolean(),
  minLawyersForApproval: z.number().int(),
  backupNote: z.string(),
  storageRegionNote: z.string(),
  version: z.number().int(),
});
export const OrgSettingsUpdateSchema = z.object({ nameRaw: RawText(200).optional(), retentionYears: z.number().int().min(1).max(100).nullable().optional(), autoDeleteEnabled: z.boolean().optional(), expectedVersion: z.number().int() });

export const HealthSchema = z.object({ ok: z.boolean(), time: TimestampSchema });

export const CreateHomeSchema = z.object({
  needsSetup: z.boolean(),
  frequentTemplates: z.array(z.object({ templateId: UuidSchema, versionId: UuidSchema, name: z.string(), kind: z.string(), sampleOnly: z.boolean(), status: z.string() })),
  recentDrafts: z.array(z.object({ id: UuidSchema, titleRaw: z.string(), kind: z.string(), status: z.string(), matterTitleRaw: z.string(), updatedAt: TimestampSchema })),
  pendingReviews: z.array(z.object({ reviewId: UuidSchema, draftId: UuidSchema, titleRaw: z.string(), matterTitleRaw: z.string(), requestedByName: z.string().nullable(), createdAt: TimestampSchema })),
});
export type CreateHome = z.infer<typeof CreateHomeSchema>;
