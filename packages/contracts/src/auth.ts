import { z } from 'zod';
import { RoleSchema, UuidSchema } from './common.js';

export const LoginRequestSchema = z.object({ email: z.string().min(1).max(320), password: z.string().min(1).max(1024) });
export const LoginResponseSchema = z.object({ mfaRequired: z.literal(true), mfaEnrolled: z.boolean() });

export const MfaVerifyRequestSchema = z.object({ code: z.string().regex(/^\d{6}$/) });
export const MfaEnrollResponseSchema = z.object({ otpauthUrl: z.string(), secret: z.string() });

export const SessionUserSchema = z.object({ id: UuidSchema, displayName: z.string(), email: z.string() });
export const SessionInfoSchema = z.object({
  authenticated: z.boolean(),
  mfaVerified: z.boolean(),
  mfaEnrolled: z.boolean(),
  user: SessionUserSchema.nullable(),
  org: z.object({ id: UuidSchema, name: z.string() }).nullable(),
  role: RoleSchema.nullable(),
  lawyerId: UuidSchema.nullable(),
  csrfToken: z.string().nullable(),
  /** 重要操作の MFA 再確認が有効か（15分以内） */
  mfaRecent: z.boolean(),
  idleExpiresAt: z.string().nullable(),
  absoluteExpiresAt: z.string().nullable(),
});
export type SessionInfo = z.infer<typeof SessionInfoSchema>;
