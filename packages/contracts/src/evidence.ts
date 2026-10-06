import { z } from 'zod';
import { ExpectedVersionSchema, RawText, TimestampSchema, UuidSchema } from './common.js';

export const EvidenceSchema = z.object({
  id: UuidSchema,
  matterId: UuidSchema,
  symbolRaw: z.string(),
  numberRaw: z.string(),
  branchRaw: z.string().nullable(),
  canonicalNumber: z.string(),
  displayLabel: z.string(),
  fileVersionId: UuidSchema.nullable(),
  fileName: z.string().nullable(),
  titleRaw: z.string(),
  authorRaw: z.string(),
  dateRaw: z.string(),
  dateIso: z.string().nullable(),
  originalCopy: z.enum(['original', 'copy']),
  proofPurposeRaw: z.string(),
  status: z.enum(['draft', 'confirmed', 'submitted', 'superseded']),
  supersededBy: UuidSchema.nullable(),
  correctionReasonRaw: z.string().nullable(),
  updatedAt: TimestampSchema,
  version: z.number().int(),
});
export type Evidence = z.infer<typeof EvidenceSchema>;

export const EvidenceInputSchema = z.object({
  matterId: UuidSchema,
  symbolRaw: RawText(10).min(1),
  numberRaw: RawText(20).min(1),
  branchRaw: RawText(20).nullable().optional(),
  fileVersionId: UuidSchema.nullable().optional(),
  titleRaw: RawText(500).default(''),
  authorRaw: RawText(200).default(''),
  dateRaw: RawText(50).default(''),
  originalCopy: z.enum(['original', 'copy']).default('copy'),
  /** 立証趣旨は弁護士が入力する */
  proofPurposeRaw: RawText(2000).default(''),
});
export const EvidenceUpdateSchema = EvidenceInputSchema.omit({ matterId: true }).partial().extend({ expectedVersion: ExpectedVersionSchema });
export const EvidenceConfirmSchema = z.object({ expectedVersion: ExpectedVersionSchema });
export const EvidenceCorrectSchema = z.object({ expectedVersion: ExpectedVersionSchema, reasonRaw: RawText(1000).min(1), symbolRaw: RawText(10).optional(), numberRaw: RawText(20).optional(), branchRaw: RawText(20).nullable().optional() });
