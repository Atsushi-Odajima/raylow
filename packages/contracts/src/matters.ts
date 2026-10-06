import { z } from 'zod';
import { ExpectedVersionSchema, PartyRoleSchema, RawText, TimestampSchema, UuidSchema } from './common.js';
import { ContactSchema } from './masters.js';

export const CaseNumberStructSchema = z.object({
  courtLabel: z.string().max(100).optional(),
  yearEra: z.string().max(10).optional(),
  eraYear: z.string().max(10).optional(),
  symbol: z.string().max(20).optional(),
  serial: z.string().max(20).optional(),
  parseStatus: z.enum(['parsed', 'needs_confirmation', 'manual']).default('needs_confirmation'),
}).partial();

export const MatterPartySchema = z.object({
  id: UuidSchema,
  matterId: UuidSchema,
  contactId: UuidSchema,
  contact: ContactSchema.pick({ id: true, type: true, nameRaw: true, organizationNameRaw: true, addressRaw: true, postcodeRaw: true }),
  role: PartyRoleSchema,
  positionRaw: z.string(),
  representativeId: UuidSchema.nullable(),
  representative: ContactSchema.pick({ id: true, nameRaw: true }).nullable(),
  version: z.number().int(),
});
export type MatterParty = z.infer<typeof MatterPartySchema>;

export const MatterAgentSchema = z.object({
  id: UuidSchema,
  matterId: UuidSchema,
  lawyerContactId: UuidSchema,
  lawyerContact: ContactSchema.pick({ id: true, nameRaw: true, organizationNameRaw: true, addressRaw: true, postcodeRaw: true, channels: true }),
  representedPartyId: UuidSchema,
  validFrom: z.string().nullable(),
  validTo: z.string().nullable(),
  version: z.number().int(),
});
export type MatterAgent = z.infer<typeof MatterAgentSchema>;

export const MatterMemberSchema = z.object({ userId: UuidSchema, displayName: z.string(), role: z.string(), canEdit: z.boolean(), approvedBy: UuidSchema.nullable() });

export const MatterSummarySchema = z.object({
  id: UuidSchema,
  orgId: UuidSchema,
  titleRaw: z.string(),
  caseNumberRaw: z.string(),
  courtRaw: z.string(),
  courtDepartmentRaw: z.string(),
  status: z.enum(['active', 'archived', 'closed']),
  acceptanceStatus: z.enum(['unconfirmed', 'confirmed', 'declined']),
  acceptanceCheckedBy: UuidSchema.nullable(),
  acceptanceCheckedAt: TimestampSchema.nullable(),
  scopeRaw: z.string(),
  leadLawyerId: UuidSchema.nullable(),
  legalHold: z.boolean(),
  updatedAt: TimestampSchema,
  version: z.number().int(),
  matchReason: z.enum(['exact', 'normalized']).optional(),
});
export type MatterSummary = z.infer<typeof MatterSummarySchema>;

export const MatterDetailSchema = MatterSummarySchema.extend({
  caseNumberStruct: CaseNumberStructSchema.nullable(),
  archiveReasonRaw: z.string().nullable(),
  parties: z.array(MatterPartySchema),
  agents: z.array(MatterAgentSchema),
  members: z.array(MatterMemberSchema),
  canEdit: z.boolean(),
  isAssignedLawyer: z.boolean(),
  documentCount: z.number().int(),
});
export type MatterDetail = z.infer<typeof MatterDetailSchema>;

export const MatterInputSchema = z.object({
  titleRaw: RawText(300).min(1),
  caseNumberRaw: RawText(100).default(''),
  caseNumberStruct: CaseNumberStructSchema.nullable().optional(),
  courtRaw: RawText(200).default(''),
  courtDepartmentRaw: RawText(100).default(''),
  scopeRaw: RawText(2000).default(''),
  leadLawyerId: UuidSchema.nullable().optional(),
  externalId: z.string().max(100).nullable().optional(),
});
export const MatterUpdateSchema = MatterInputSchema.partial().extend({ expectedVersion: ExpectedVersionSchema });
export const MatterListQuerySchema = z.object({
  q: z.string().max(200).optional(),
  status: z.enum(['active', 'archived', 'closed']).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export const MatterAcceptanceSchema = z.object({ acceptanceStatus: z.enum(['unconfirmed', 'confirmed', 'declined']), expectedVersion: ExpectedVersionSchema });
export const MatterStatusChangeSchema = z.object({ status: z.enum(['active', 'archived', 'closed']), reasonRaw: RawText(500).optional(), expectedVersion: ExpectedVersionSchema });
export const MatterLegalHoldSchema = z.object({ legalHold: z.boolean(), reasonRaw: RawText(500).optional(), expectedVersion: ExpectedVersionSchema });

export const PartyInputSchema = z.object({ contactId: UuidSchema, role: PartyRoleSchema, positionRaw: RawText(100).default(''), representativeId: UuidSchema.nullable().optional() });
export const PartyUpdateSchema = PartyInputSchema.partial().extend({ expectedVersion: ExpectedVersionSchema });
export const AgentInputSchema = z.object({ lawyerContactId: UuidSchema, representedPartyId: UuidSchema, validFrom: z.string().nullable().optional(), validTo: z.string().nullable().optional() });
export const MemberAddSchema = z.object({ userId: UuidSchema, canEdit: z.boolean().default(true) });
export const BarrierAddSchema = z.object({ userId: UuidSchema, reason: RawText(500).min(1) });
