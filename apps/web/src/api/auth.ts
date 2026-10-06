import { useMutation } from '@tanstack/react-query';
import { z } from 'zod';
import { LoginRequestSchema, LoginResponseSchema, MfaEnrollResponseSchema, MfaVerifyRequestSchema, SessionInfoSchema, type SessionInfo } from '@raylow/contracts';
import { apiRequest } from '../lib/apiClient';
import { queryClient } from '../lib/queryClient';
import { sessionStore } from '../lib/session';

export type LoginInput = z.infer<typeof LoginRequestSchema>;
export type LoginResult = z.infer<typeof LoginResponseSchema>;
export type MfaEnroll = z.infer<typeof MfaEnrollResponseSchema>;

export function login(input: LoginInput): Promise<LoginResult> {
  return apiRequest<LoginResult>('/api/auth/login', { method: 'POST', body: LoginRequestSchema.parse(input), schema: LoginResponseSchema, silentUnauthorized: true });
}
export function mfaEnroll(): Promise<MfaEnroll> {
  return apiRequest<MfaEnroll>('/api/auth/mfa/enroll', { method: 'POST', schema: MfaEnrollResponseSchema, silentUnauthorized: true });
}
export function mfaEnrollConfirm(code: string): Promise<SessionInfo> {
  return apiRequest<SessionInfo>('/api/auth/mfa/enroll/confirm', { method: 'POST', body: MfaVerifyRequestSchema.parse({ code }), schema: SessionInfoSchema, silentUnauthorized: true });
}
export function mfaVerify(code: string): Promise<SessionInfo> {
  return apiRequest<SessionInfo>('/api/auth/mfa/verify', { method: 'POST', body: MfaVerifyRequestSchema.parse({ code }), schema: SessionInfoSchema, silentUnauthorized: true });
}
export function stepUp(code: string): Promise<SessionInfo> {
  return apiRequest<SessionInfo>('/api/auth/step-up', { method: 'POST', body: MfaVerifyRequestSchema.parse({ code }), schema: SessionInfoSchema });
}
export async function logout(): Promise<void> {
  try {
    await apiRequest<{ ok: true }>('/api/auth/logout', { method: 'POST', silentUnauthorized: true });
  } finally {
    // メモリ上の query cache とセッション情報を破棄（過去の文書を表示しない）
    queryClient.clear();
    sessionStore.reset();
  }
}

export function useLogout() {
  return useMutation({ mutationFn: logout });
}
