/**
 * 認証プロバイダ。
 * - local: private.local_credentials（scrypt）。開発/テスト、または Supabase Auth 未接続環境。
 * - supabase: GoTrue の password grant（/auth/v1/token?grant_type=password）。refresh token は暗号化して server_sessions へ。
 *   ※ 本リポジトリの開発コンテナでは GoTrue を起動できなかったため supabase プロバイダは未検証（HANDOFF 参照）。
 */
import { config } from '../config.js';
import { withServiceTx } from '../db/pool.js';
import { encryptSecret, verifyPassword } from './crypto.js';

export interface AuthResult {
  ok: boolean;
  userId?: string;
  orgId?: string;
  refreshTokenEnc?: string | null;
  reason?: 'invalid_credentials' | 'locked' | 'no_membership' | 'provider_error';
}

async function resolveMembership(userId: string): Promise<string | null> {
  return withServiceTx(async (tx) => {
    const r = await tx.query<{ org_id: string }>(`SELECT m.org_id FROM public.memberships m JOIN public.app_users u ON u.id = m.user_id WHERE m.user_id = $1 AND m.status = 'active' AND u.status = 'active' ORDER BY m.created_at LIMIT 1`, [userId]);
    return r.rows[0]?.org_id ?? null;
  });
}

export async function authenticateLocal(email: string, password: string): Promise<AuthResult> {
  const emailKey = email.trim().toLowerCase();
  const row = await withServiceTx(async (tx) => {
    const r = await tx.query<{ user_id: string; password_hash: string; failed_attempts: number; locked_until: string | null }>(
      `SELECT c.user_id, c.password_hash, c.failed_attempts, c.locked_until FROM private.local_credentials c JOIN public.app_users u ON u.id = c.user_id WHERE u.email_key = $1 FOR UPDATE OF c`,
      [emailKey],
    );
    return r.rows[0] ?? null;
  });
  if (!row) {
    // タイミング差を減らすためダミー検証
    await verifyPassword(password, 'scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=');
    return { ok: false, reason: 'invalid_credentials' };
  }
  if (row.locked_until && new Date(row.locked_until).getTime() > Date.now()) return { ok: false, reason: 'locked' };
  const ok = await verifyPassword(password, row.password_hash);
  if (!ok) {
    await withServiceTx((tx) =>
      tx.query(`UPDATE private.local_credentials SET failed_attempts = failed_attempts + 1, locked_until = CASE WHEN failed_attempts + 1 >= 10 THEN now() + interval '15 minutes' ELSE locked_until END, updated_at = now() WHERE user_id = $1`, [row.user_id]),
    );
    return { ok: false, reason: 'invalid_credentials' };
  }
  await withServiceTx((tx) => tx.query('UPDATE private.local_credentials SET failed_attempts = 0, locked_until = NULL, updated_at = now() WHERE user_id = $1', [row.user_id]));
  const orgId = await resolveMembership(row.user_id);
  if (!orgId) return { ok: false, reason: 'no_membership' };
  return { ok: true, userId: row.user_id, orgId, refreshTokenEnc: null };
}

export async function authenticateSupabase(email: string, password: string): Promise<AuthResult> {
  if (!config.supabase.url || !config.supabase.anonKey) return { ok: false, reason: 'provider_error' };
  const res = await fetch(`${config.supabase.url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: config.supabase.anonKey },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) return { ok: false, reason: 'invalid_credentials' };
  const body = (await res.json()) as { user?: { id?: string }; refresh_token?: string };
  const providerUserId = body.user?.id;
  if (!providerUserId) return { ok: false, reason: 'provider_error' };
  const userId = await withServiceTx(async (tx) => {
    const r = await tx.query<{ user_id: string }>(`SELECT user_id FROM private.identity_links WHERE provider = 'supabase' AND provider_user_id = $1`, [providerUserId]);
    return r.rows[0]?.user_id ?? null;
  });
  if (!userId) return { ok: false, reason: 'no_membership' };
  const orgId = await resolveMembership(userId);
  if (!orgId) return { ok: false, reason: 'no_membership' };
  return { ok: true, userId, orgId, refreshTokenEnc: body.refresh_token ? encryptSecret(body.refresh_token) : null };
}

export function authenticate(email: string, password: string): Promise<AuthResult> {
  return config.authProvider === 'supabase' ? authenticateSupabase(email, password) : authenticateLocal(email, password);
}
