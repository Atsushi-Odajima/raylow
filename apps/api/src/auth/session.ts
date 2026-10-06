import { MFA_RECENT_MINUTES, SESSION_ABSOLUTE_HOURS, SESSION_IDLE_MINUTES } from '@raylow/domain';
import { withServiceTx } from '../db/pool.js';
import { randomToken, sha256Hex } from './crypto.js';

export interface SessionRow {
  id: string;
  user_id: string;
  org_id: string;
  idle_expiry: string;
  absolute_expiry: string;
  last_mfa_at: string | null;
  mfa_pending: boolean;
  csrf_token_hash: string;
  revoked_at: string | null;
}

export interface ResolvedSession {
  session: SessionRow;
  csrfToken: string | null;
  user: { id: string; email: string; displayName: string; status: string };
  role: 'admin' | 'lawyer' | 'staff';
  orgName: string;
  lawyerId: string | null;
  mfaEnrolled: boolean;
}

export async function createSession(userId: string, orgId: string, userAgent: string | undefined): Promise<{ cookieValue: string; csrfToken: string; id: string }> {
  const cookieValue = randomToken(32);
  const csrfToken = randomToken(32);
  const now = Date.now();
  const id = await withServiceTx(async (tx) => {
    const r = await tx.query<{ id: string }>(
      `INSERT INTO private.server_sessions (cookie_hash, user_id, org_id, idle_expiry, absolute_expiry, mfa_pending, csrf_token_hash, user_agent_hash)
       VALUES ($1, $2, $3, $4, $5, true, $6, $7) RETURNING id`,
      [sha256Hex(cookieValue), userId, orgId, new Date(now + SESSION_IDLE_MINUTES * 60_000).toISOString(), new Date(now + SESSION_ABSOLUTE_HOURS * 3_600_000).toISOString(), sha256Hex(csrfToken), userAgent ? sha256Hex(userAgent) : null],
    );
    return r.rows[0]!.id;
  });
  // csrf token は cookie と同時にクライアントへ返す（セッションごとに 1 つ。hash のみ保存するため再取得時は再発行する）
  return { cookieValue, csrfToken, id };
}

/** cookie から session を解決し idle expiry を延長する。失効/期限切れは null。 */
export async function resolveSession(cookieValue: string | undefined): Promise<ResolvedSession | null> {
  if (!cookieValue) return null;
  const hash = sha256Hex(cookieValue);
  return withServiceTx(async (tx) => {
    const r = await tx.query<SessionRow & { email_raw: string; display_name_raw: string; user_status: string; role: 'admin' | 'lawyer' | 'staff'; membership_status: string; org_name: string; lawyer_id: string | null; mfa_enrolled_at: string | null }>(
      `SELECT s.id, s.user_id, s.org_id, s.idle_expiry, s.absolute_expiry, s.last_mfa_at, s.mfa_pending, s.csrf_token_hash, s.revoked_at,
              u.email_raw, u.display_name_raw, u.status AS user_status,
              m.role, m.status AS membership_status, o.name_raw AS org_name,
              l.id AS lawyer_id, t.enrolled_at AS mfa_enrolled_at
       FROM private.server_sessions s
       JOIN public.app_users u ON u.id = s.user_id
       JOIN public.memberships m ON m.org_id = s.org_id AND m.user_id = s.user_id
       JOIN public.organizations o ON o.id = s.org_id
       LEFT JOIN public.lawyers l ON l.org_id = s.org_id AND l.user_id = s.user_id AND l.active
       LEFT JOIN private.mfa_totp t ON t.user_id = s.user_id
       WHERE s.cookie_hash = $1
       FOR UPDATE OF s`,
      [hash],
    );
    const row = r.rows[0];
    if (!row) return null;
    const now = Date.now();
    if (row.revoked_at || new Date(row.idle_expiry).getTime() < now || new Date(row.absolute_expiry).getTime() < now) {
      return null;
    }
    if (row.user_status !== 'active' || row.membership_status !== 'active') {
      await tx.query('UPDATE private.server_sessions SET revoked_at = now() WHERE id = $1', [row.id]);
      return null;
    }
    const newIdle = new Date(Math.min(now + SESSION_IDLE_MINUTES * 60_000, new Date(row.absolute_expiry).getTime())).toISOString();
    await tx.query('UPDATE private.server_sessions SET idle_expiry = $2, last_seen_at = now() WHERE id = $1', [row.id, newIdle]);
    return {
      session: { ...row, idle_expiry: newIdle },
      csrfToken: null,
      user: { id: row.user_id, email: row.email_raw, displayName: row.display_name_raw, status: row.user_status },
      role: row.role,
      orgName: row.org_name,
      lawyerId: row.lawyer_id,
      mfaEnrolled: row.mfa_enrolled_at !== null,
    };
  });
}

export async function rotateCsrf(sessionId: string): Promise<string> {
  const token = randomToken(32);
  await withServiceTx((tx) => tx.query('UPDATE private.server_sessions SET csrf_token_hash = $2 WHERE id = $1', [sessionId, sha256Hex(token)]));
  return token;
}

export function csrfMatches(session: SessionRow, token: string | undefined): boolean {
  if (!token) return false;
  return sha256Hex(token) === session.csrf_token_hash;
}

export async function markMfaVerified(sessionId: string): Promise<void> {
  await withServiceTx((tx) => tx.query('UPDATE private.server_sessions SET mfa_pending = false, last_mfa_at = now() WHERE id = $1', [sessionId]));
}

export async function revokeSession(sessionId: string): Promise<void> {
  await withServiceTx((tx) => tx.query('UPDATE private.server_sessions SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL', [sessionId]));
}

export async function revokeAllUserSessions(userId: string): Promise<void> {
  await withServiceTx((tx) => tx.query('UPDATE private.server_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [userId]));
}

export function mfaRecent(session: SessionRow): boolean {
  if (!session.last_mfa_at) return false;
  return Date.now() - new Date(session.last_mfa_at).getTime() <= MFA_RECENT_MINUTES * 60_000;
}
