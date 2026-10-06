import { z } from 'zod';
import { JobStateSchema, TimestampSchema, UuidSchema } from './common.js';

export const JobSchema = z.object({
  id: UuidSchema,
  orgId: UuidSchema,
  matterId: UuidSchema.nullable(),
  type: z.string(),
  state: JobStateSchema,
  attempt: z.number().int(),
  maxAttempts: z.number().int(),
  progress: z.record(z.unknown()),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  result: z.record(z.unknown()).nullable(),
  cancelRequested: z.boolean(),
  runAfter: TimestampSchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  /** 失敗時の修正導線 */
  retryable: z.boolean(),
  fixLink: z.string().nullable(),
});
export type Job = z.infer<typeof JobSchema>;

export const JOB_TYPES = ['render_draft', 'render_final', 'inspect_template', 'test_template', 'scan_file', 'batch_render', 'render_packet', 'export', 'import_csv', 'external_edit_ingest'] as const;
export const JobTypeSchema = z.enum(JOB_TYPES);
export type JobType = z.infer<typeof JobTypeSchema>;
