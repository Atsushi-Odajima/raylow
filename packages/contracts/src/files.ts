import { z } from 'zod';
import { RawText, ScanStatusSchema, TimestampSchema, UuidSchema } from './common.js';

export const FileSchema = z.object({
  id: UuidSchema,
  orgId: UuidSchema,
  matterId: UuidSchema.nullable(),
  scope: z.enum(['matter', 'template', 'output', 'packet', 'export', 'receipt']),
  originalNameRaw: z.string(),
  mime: z.string(),
  size: z.number().int(),
  sha256: z.string(),
  scanStatus: ScanStatusSchema,
  scanReport: z.record(z.unknown()).nullable(),
  confidential: z.boolean(),
  versions: z.array(z.object({ id: UuidSchema, revision: z.number().int(), kind: z.string(), sha256: z.string(), size: z.number().int(), encodingName: z.string().nullable(), createdAt: TimestampSchema })).default([]),
  createdAt: TimestampSchema,
  version: z.number().int(),
});
export type FileInfo = z.infer<typeof FileSchema>;

export const UploadInitSchema = z.object({
  matterId: UuidSchema.nullable().optional(),
  scope: z.enum(['matter', 'template', 'receipt']),
  originalName: RawText(255).min(1),
  mime: z.string().max(200),
  size: z.number().int().positive(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  confidential: z.boolean().default(true),
});
export const UploadInitResponseSchema = z.object({ uploadId: UuidSchema, fileId: UuidSchema, maxBytes: z.number().int(), expiresAt: TimestampSchema });
export const UploadFinalizeResponseSchema = z.object({ file: FileSchema, scanJobId: UuidSchema.nullable() });
