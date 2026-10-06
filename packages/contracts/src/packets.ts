import { z } from 'zod';
import { ExpectedVersionSchema, RawText, TimestampSchema, UuidSchema } from './common.js';

export const PacketItemInputSchema = z.object({
  /** 草案 ID を指定すると承認済み正式 PDF 出力を server が解決する */
  draftId: UuidSchema.nullable().optional(),
  outputId: UuidSchema.nullable().optional(),
  fileVersionId: UuidSchema.nullable().optional(),
  evidenceId: UuidSchema.nullable().optional(),
  displayNameRaw: RawText(200).default(''),
  orderNo: z.number().int().min(1),
  /** 機密資料の外部出力可否は資料ごとに指定して確認 */
  externalOutputConfirmed: z.boolean().default(false),
});
export const PacketCreateSchema = z.object({ matterId: UuidSchema, courtProfileId: UuidSchema, titleRaw: RawText(200).default(''), items: z.array(PacketItemInputSchema).max(200).default([]) });
export const PacketUpdateSchema = z.object({ expectedVersion: ExpectedVersionSchema, titleRaw: RawText(200).optional(), courtProfileId: UuidSchema.optional(), items: z.array(PacketItemInputSchema).max(200) });
export const PacketItemSchema = PacketItemInputSchema.extend({ id: UuidSchema, kind: z.enum(['document_pdf', 'document_docx', 'evidence_pdf', 'file']), sourceLabel: z.string(), sha256: z.string().nullable(), confidential: z.boolean(), approved: z.boolean().nullable() });
export const PacketSchema = z.object({
  id: UuidSchema,
  matterId: UuidSchema,
  revision: z.number().int(),
  titleRaw: z.string(),
  status: z.enum(['draft', 'checking', 'blocked', 'ready', 'rendering', 'rendered', 'failed', 'archived']),
  courtProfileId: UuidSchema.nullable(),
  courtProfileName: z.string().nullable(),
  items: z.array(PacketItemSchema),
  manifest: z.record(z.unknown()).nullable(),
  hash: z.string().nullable(),
  fileId: UuidSchema.nullable(),
  checkReport: z.object({ issues: z.array(z.object({ severity: z.enum(['error', 'warning']), code: z.string(), message: z.string(), itemId: UuidSchema.optional(), link: z.string().optional() })), blocking: z.boolean(), checkedAt: TimestampSchema }).nullable(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  version: z.number().int(),
});
export type Packet = z.infer<typeof PacketSchema>;

export const DispatchRecordInputSchema = z.object({
  matterId: UuidSchema,
  packetId: UuidSchema.nullable().optional(),
  outputId: UuidSchema.nullable().optional(),
  recipientSnapshot: z.object({ nameRaw: RawText(200), organizationNameRaw: RawText(200).default(''), addressRaw: RawText(500).default(''), type: z.string().max(50) }),
  method: z.enum(['post', 'registered_post', 'content_certified_post', 'fax', 'email', 'hand', 'court_counter', 'court_electronic', 'other']),
  methodNoteRaw: RawText(200).optional(),
  sentAt: z.string(),
  receiptRaw: RawText(500).default(''),
  receiptFileId: UuidSchema.nullable().optional(),
  receivedDocumentsRaw: RawText(2000).default(''),
});
export const DispatchRecordSchema = DispatchRecordInputSchema.extend({
  id: UuidSchema,
  status: z.enum(['recorded', 'received_verified']),
  recordedBy: UuidSchema.nullable(),
  recordedByName: z.string().nullable(),
  verifiedBy: UuidSchema.nullable(),
  verifiedByName: z.string().nullable(),
  verifiedAt: TimestampSchema.nullable(),
  outputLabel: z.string().nullable(),
  createdAt: TimestampSchema,
  version: z.number().int(),
});
export type DispatchRecord = z.infer<typeof DispatchRecordSchema>;
export const DispatchVerifySchema = z.object({ expectedVersion: ExpectedVersionSchema });
