import { z } from 'zod';

/** API 共通: {data, meta:{requestId}} / error={code,message,fieldErrors,requestId} */
export const ErrorCodeSchema = z.enum([
  'unauthorized',
  'mfa_required',
  'forbidden',
  'not_found',
  'conflict',
  'version_conflict',
  'payload_too_large',
  'unsupported_media_type',
  'validation_failed',
  'rate_limited',
  'csrf_failed',
  'origin_not_allowed',
  'precondition_failed',
  'batch_limit_exceeded',
  'template_not_published',
  'template_sample_only',
  'approval_denied',
  'hash_stale',
  'lease_held',
  'job_failed',
  'file_quarantined',
  'file_rejected',
  'scanner_unavailable',
  'internal_error',
]);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

export const FieldErrorSchema = z.object({ field: z.string(), code: z.string(), message: z.string() });
export type FieldError = z.infer<typeof FieldErrorSchema>;

export const ApiErrorSchema = z.object({
  error: z.object({
    code: ErrorCodeSchema,
    message: z.string(),
    fieldErrors: z.array(FieldErrorSchema).default([]),
    requestId: z.string(),
    /** 409 のとき現在版 */
    currentVersion: z.number().int().optional(),
    details: z.record(z.unknown()).optional(),
  }),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

export const MetaSchema = z.object({ requestId: z.string(), nextCursor: z.string().nullable().optional(), total: z.number().int().optional() });

export function okEnvelope<T extends z.ZodTypeAny>(data: T) {
  return z.object({ data, meta: MetaSchema });
}

export const UuidSchema = z.string().uuid();
export const CursorQuerySchema = z.object({ cursor: z.string().max(200).optional(), limit: z.coerce.number().int().min(1).max(100).default(50) });
export const ExpectedVersionSchema = z.number().int().min(1);

/** タイムスタンプは UTC ISO 文字列。表示は Asia/Tokyo */
export const TimestampSchema = z.string();

export const RoleSchema = z.enum(['admin', 'lawyer', 'staff']);
export type Role = z.infer<typeof RoleSchema>;

export const RecipientTypeSchema = z.enum(['opponent_agent', 'opponent', 'client', 'court', 'third_party', 'none']);
export type RecipientType = z.infer<typeof RecipientTypeSchema>;

export const PartyRoleSchema = z.enum(['client', 'opponent', 'co_party', 'third_party']);
export type PartyRole = z.infer<typeof PartyRoleSchema>;

export const ContactTypeSchema = z.enum(['person', 'organization', 'lawyer']);
export type ContactType = z.infer<typeof ContactTypeSchema>;

export const DraftStatusSchema = z.enum(['draft', 'rendering', 'ready_for_review', 'in_review', 'changes_requested', 'approved', 'superseded', 'archived']);
export type DraftStatus = z.infer<typeof DraftStatusSchema>;

export const TemplateVersionStatusSchema = z.enum(['draft', 'testing', 'published', 'retired']);
export const JobStateSchema = z.enum(['queued', 'running', 'succeeded', 'failed', 'cancelled']);
export const ScanStatusSchema = z.enum(['quarantine', 'scanning', 'clean', 'infected', 'rejected', 'scan_failed']);

/** 原文を含む文字列欄。正規化しない */
export const RawText = (max = 2000) => z.string().max(max);
