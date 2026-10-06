import { z } from 'zod';
import { RecipientTypeSchema, TimestampSchema, UuidSchema } from './common.js';

export const BatchRecipientSchema = z.object({ type: RecipientTypeSchema, contactId: UuidSchema.nullable() });
export const BatchCreateSchema = z.object({
  matterId: UuidSchema,
  templateVersionIds: z.array(UuidSchema).min(1).max(20),
  recipients: z.array(BatchRecipientSchema).min(1).max(50),
  idempotencyKey: z.string().min(8).max(100),
  purpose: z.enum(['drafts', 'submission_pack']).default('drafts'),
});
export const BatchItemSchema = z.object({
  id: UuidSchema,
  batchId: UuidSchema,
  draftId: UuidSchema.nullable(),
  templateVersionId: UuidSchema,
  templateName: z.string(),
  recipientSnapshot: z.record(z.unknown()),
  status: z.enum(['queued', 'running', 'succeeded', 'failed', 'cancelled']),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  jobId: UuidSchema.nullable(),
  attempt: z.number().int(),
});
export const BatchSchema = z.object({
  id: UuidSchema,
  matterId: UuidSchema,
  status: z.enum(['queued', 'running', 'partial_failed', 'succeeded', 'failed', 'cancelled']),
  purpose: z.enum(['drafts', 'submission_pack']),
  items: z.array(BatchItemSchema),
  counts: z.object({ total: z.number().int(), succeeded: z.number().int(), failed: z.number().int(), queued: z.number().int(), running: z.number().int() }),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  version: z.number().int(),
});
export type Batch = z.infer<typeof BatchSchema>;
