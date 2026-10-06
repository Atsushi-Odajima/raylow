import { z } from 'zod';
import { ExpectedVersionSchema, RawText, TimestampSchema, UuidSchema } from './common.js';
import { DraftOutputSchema, DraftRevisionSchema, DraftSchema, PreflightReportSchema } from './drafts.js';

export const ReviewSchema = z.object({
  id: UuidSchema,
  revisionId: UuidSchema,
  draftId: UuidSchema,
  targetHash: z.string(),
  targetOutputPdfSha256: z.string().nullable(),
  targetOutputDocxSha256: z.string().nullable(),
  reviewerId: UuidSchema.nullable(),
  reviewerName: z.string().nullable(),
  requestedBy: UuidSchema.nullable(),
  requestedByName: z.string().nullable(),
  status: z.enum(['pending', 'approved', 'changes_requested', 'withdrawn']),
  decisionReason: z.string().nullable(),
  decidedAt: TimestampSchema.nullable(),
  createdAt: TimestampSchema,
  version: z.number().int(),
});
export type Review = z.infer<typeof ReviewSchema>;

export const ReviewCommentSchema = z.object({ id: UuidSchema, reviewId: UuidSchema, blockId: z.string().nullable(), fieldKey: z.string().nullable(), bodyRaw: z.string(), createdBy: UuidSchema.nullable(), createdByName: z.string().nullable(), resolvedAt: TimestampSchema.nullable(), createdAt: TimestampSchema });

export const ReviewDetailSchema = z.object({
  review: ReviewSchema,
  draft: DraftSchema,
  revision: DraftRevisionSchema,
  previousApprovedRevision: DraftRevisionSchema.nullable(),
  outputs: z.array(DraftOutputSchema),
  preflight: PreflightReportSchema.nullable(),
  comments: z.array(ReviewCommentSchema),
  /** 現在 revision hash と一致しているか（不一致なら再生成へ） */
  hashCurrent: z.boolean(),
  canDecide: z.boolean(),
  denialReason: z.string().nullable(),
});
export type ReviewDetail = z.infer<typeof ReviewDetailSchema>;

export const ReviewDecisionSchema = z.object({
  decision: z.enum(['approved', 'changes_requested']),
  targetHash: z.string(),
  targetOutputPdfSha256: z.string().nullable().optional(),
  expectedVersion: ExpectedVersionSchema,
  reason: RawText(2000).optional(),
  /** 警告のうち要確認項目への理由付き確認 */
  confirmations: z.array(z.object({ code: z.string(), reason: RawText(500).min(1) })).default([]),
});
export const ReviewCommentInputSchema = z.object({ blockId: z.string().max(64).nullable().optional(), fieldKey: z.string().max(64).nullable().optional(), bodyRaw: RawText(5000).min(1) });
export const ReviewListQuerySchema = z.object({ status: z.enum(['pending', 'approved', 'changes_requested', 'withdrawn']).optional(), mine: z.coerce.boolean().optional(), cursor: z.string().optional(), limit: z.coerce.number().int().min(1).max(100).default(50) });
