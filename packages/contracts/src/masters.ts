import { z } from 'zod';
import { ContactTypeSchema, ExpectedVersionSchema, RawText, RoleSchema, TimestampSchema, UuidSchema } from './common.js';

export const HonorificSettingsSchema = z.object({ person: z.string().max(10), lawyer: z.string().max(10), organization: z.string().max(10), court: z.string().max(10) });

export const OfficeProfileSchema = z.object({
  id: UuidSchema,
  orgId: UuidSchema,
  revision: z.number().int(),
  nameRaw: z.string(),
  addressRaw: z.string(),
  postcodeRaw: z.string(),
  phoneRaw: z.string(),
  faxRaw: z.string(),
  emailRaw: z.string(),
  signatureSettings: z.record(z.unknown()),
  honorificSettings: HonorificSettingsSchema,
  isCurrent: z.boolean(),
  createdAt: TimestampSchema,
  version: z.number().int(),
});
export type OfficeProfile = z.infer<typeof OfficeProfileSchema>;

export const OfficeProfileInputSchema = z.object({
  nameRaw: RawText(200).min(1),
  addressRaw: RawText(500),
  postcodeRaw: RawText(20),
  phoneRaw: RawText(50),
  faxRaw: RawText(50),
  emailRaw: RawText(320),
  signatureSettings: z.record(z.unknown()).default({}),
  honorificSettings: HonorificSettingsSchema.default({ person: '様', lawyer: '先生', organization: '御中', court: '御中' }),
});
export const OfficeProfileUpdateSchema = OfficeProfileInputSchema.extend({ expectedVersion: ExpectedVersionSchema });

export const LawyerSchema = z.object({
  id: UuidSchema,
  orgId: UuidSchema,
  userId: UuidSchema.nullable(),
  nameRaw: z.string(),
  kana: z.string(),
  titleRaw: z.string(),
  registrationNumberRaw: z.string(),
  officeProfileId: UuidSchema.nullable(),
  active: z.boolean(),
  version: z.number().int(),
});
export type Lawyer = z.infer<typeof LawyerSchema>;
export const LawyerInputSchema = z.object({
  nameRaw: RawText(100).min(1),
  kana: RawText(100).default(''),
  titleRaw: RawText(50).default('弁護士'),
  registrationNumberRaw: RawText(50).default(''),
  userId: UuidSchema.nullable().optional(),
  officeProfileId: UuidSchema.nullable().optional(),
  active: z.boolean().default(true),
});
export const LawyerUpdateSchema = LawyerInputSchema.partial().extend({ expectedVersion: ExpectedVersionSchema });

export const ContactChannelsSchema = z.object({ phone: z.string().max(50).optional(), fax: z.string().max(50).optional(), email: z.string().max(320).optional(), note: z.string().max(500).optional() }).partial();

export const ContactSchema = z.object({
  id: UuidSchema,
  orgId: UuidSchema,
  type: ContactTypeSchema,
  nameRaw: z.string(),
  kana: z.string(),
  organizationNameRaw: z.string(),
  addressRaw: z.string(),
  postcodeRaw: z.string(),
  channels: ContactChannelsSchema,
  externalId: z.string().nullable(),
  checkedAt: TimestampSchema.nullable(),
  notesRaw: z.string(),
  aliases: z.array(z.object({ id: UuidSchema, aliasRaw: z.string() })).default([]),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  version: z.number().int(),
  /** 検索時: 一致理由 */
  matchReason: z.enum(['exact', 'normalized', 'alias']).optional(),
  /** 類似名の提案（merge はしない） */
  similarIds: z.array(UuidSchema).optional(),
});
export type Contact = z.infer<typeof ContactSchema>;

export const ContactInputSchema = z.object({
  type: ContactTypeSchema,
  nameRaw: RawText(200).min(1),
  kana: RawText(200).default(''),
  organizationNameRaw: RawText(200).default(''),
  addressRaw: RawText(500).default(''),
  postcodeRaw: RawText(20).default(''),
  channels: ContactChannelsSchema.default({}),
  externalId: z.string().max(100).nullable().optional(),
  checkedAt: TimestampSchema.nullable().optional(),
  notesRaw: RawText(2000).default(''),
});
export const ContactUpdateSchema = ContactInputSchema.partial().extend({ expectedVersion: ExpectedVersionSchema });
export const ContactSearchQuerySchema = z.object({
  q: z.string().max(200).optional(),
  type: ContactTypeSchema.optional(),
  mode: z.enum(['normalized', 'exact']).default('normalized'),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const MemberSchema = z.object({
  userId: UuidSchema,
  displayName: z.string(),
  email: z.string(),
  role: RoleSchema,
  status: z.enum(['active', 'suspended', 'left']),
  lawyerId: UuidSchema.nullable(),
  mfaEnrolled: z.boolean(),
});
export type Member = z.infer<typeof MemberSchema>;
export const MemberInviteSchema = z.object({ email: z.string().email().max(320), displayNameRaw: RawText(100).min(1), role: RoleSchema, initialPassword: z.string().min(12).max(1024).optional() });
