import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { LoginRequestSchema, MfaVerifyRequestSchema, type SessionInfo } from '@raylow/contracts';
import { config } from '../config.js';
import { withServiceTx } from '../db/pool.js';
import { ApiError, forbidden, unauthorized } from '../errors.js';
import { parseOrThrow } from '../lib/validate.js';
import { ok } from '../lib/reply.js';
import { authenticate } from '../auth/provider.js';
import { createSession, markMfaVerified, mfaRecent, resolveSession, revokeSession, rotateCsrf, type ResolvedSession } from '../auth/session.js';
import { decryptSecret, encryptSecret } from '../auth/crypto.js';
import { newTotpSecret, totpUri, verifyTotp } from '../auth/totp.js';

function cookieOpts() {
  return { httpOnly: true, secure: config.cookieSecure, sameSite: 'lax' as const, path: '/', maxAge: 12 * 3600 };
}

export function sessionInfo(info: ResolvedSession | null, csrfToken: string | null): SessionInfo {
  if (!info) {
    return { authenticated: false, mfaVerified: false, mfaEnrolled: false, user: null, org: null, role: null, lawyerId: null, csrfToken: null, mfaRecent: false, idleExpiresAt: null, absoluteExpiresAt: null };
  }
  return {
    authenticated: true,
    mfaVerified: !info.session.mfa_pending,
    mfaEnrolled: info.mfaEnrolled,
    user: { id: info.user.id, displayName: info.user.displayName, email: info.user.email },
    org: { id: info.session.org_id, name: info.orgName },
    role: info.role,
    lawyerId: info.lawyerId,
    csrfToken,
    mfaRecent: mfaRecent(info.session),
    idleExpiresAt: info.session.idle_expiry,
    absoluteExpiresAt: info.session.absolute_expiry,
  };
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/auth/login', { config: { auth: { public: true }, rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const body = parseOrThrow(LoginRequestSchema, req.body);
    const result = await authenticate(body.email, body.password);
    if (!result.ok || !result.userId || !result.orgId) {
      if (result.reason === 'locked') throw new ApiError(429, 'rate_limited', 'ログイン試行が多すぎます。15分後に再試行してください');
      throw unauthorized('メールアドレスまたはパスワードが正しくありません');
    }
    // 既存 cookie があれば失効
    const old = req.cookies[config.cookieName];
    if (old) {
      const prev = await resolveSession(old);
      if (prev) await revokeSession(prev.session.id);
    }
    const s = await createSession(result.userId, result.orgId, req.headers['user-agent']);
    if (result.refreshTokenEnc) {
      await withServiceTx((tx) => tx.query('UPDATE private.server_sessions SET refresh_token_enc = $2 WHERE id = $1', [s.id, result.refreshTokenEnc]));
    }
    const enrolled = await withServiceTx(async (tx) => {
      const r = await tx.query<{ enrolled_at: string | null }>('SELECT enrolled_at FROM private.mfa_totp WHERE user_id = $1', [result.userId]);
      return r.rows[0]?.enrolled_at != null;
    });
    void reply.setCookie(config.cookieName, s.cookieValue, cookieOpts());
    // csrf token は MFA 検証後の session 応答で渡す（MFA 画面でも必要なので header で先渡し）
    reply.header('X-CSRF-Token', s.csrfToken);
    return ok(req, reply, { mfaRequired: true as const, mfaEnrolled: enrolled, csrfToken: s.csrfToken });
  });

  app.get('/api/auth/session', { config: { auth: { public: true } } }, async (req, reply) => {
    const info = req.sessionInfo;
    if (!info) return ok(req, reply, sessionInfo(null, null));
    const csrf = await rotateCsrf(info.session.id);
    return ok(req, reply, sessionInfo(info, csrf));
  });

  app.post('/api/auth/mfa/enroll', { config: { auth: { allowMfaPending: true } } }, async (req, reply) => {
    const info = req.sessionInfo!;
    const existing = await withServiceTx(async (tx) => {
      const r = await tx.query<{ enrolled_at: string | null }>('SELECT enrolled_at FROM private.mfa_totp WHERE user_id = $1', [info.user.id]);
      return r.rows[0] ?? null;
    });
    if (existing?.enrolled_at) throw forbidden('MFA は既に登録済みです');
    const secret = newTotpSecret();
    await withServiceTx((tx) =>
      tx.query(`INSERT INTO private.mfa_totp (user_id, secret_enc) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET secret_enc = EXCLUDED.secret_enc, enrolled_at = NULL, last_used_counter = NULL`, [info.user.id, encryptSecret(secret)]),
    );
    return ok(req, reply, { otpauthUrl: totpUri(secret, info.user.email), secret });
  });

  const verifyHandler = (mode: 'enroll' | 'verify' | 'step_up') => async (req: FastifyRequest, reply: FastifyReply) => {
    const info = req.sessionInfo!;
    const body = parseOrThrow(MfaVerifyRequestSchema, req.body);
    const row = await withServiceTx(async (tx) => {
      const r = await tx.query<{ secret_enc: string; enrolled_at: string | null; last_used_counter: string | null }>('SELECT secret_enc, enrolled_at, last_used_counter FROM private.mfa_totp WHERE user_id = $1 FOR UPDATE', [info.user.id]);
      return r.rows[0] ?? null;
    });
    if (!row) throw new ApiError(409, 'precondition_failed', 'MFA が登録されていません。先に登録してください');
    if (mode !== 'enroll' && !row.enrolled_at) throw new ApiError(409, 'precondition_failed', 'MFA 登録を完了してください');
    const v = verifyTotp(decryptSecret(row.secret_enc), body.code, row.last_used_counter == null ? null : Number(row.last_used_counter));
    if (!v.ok) throw unauthorized('認証コードが正しくありません');
    await withServiceTx((tx) => tx.query('UPDATE private.mfa_totp SET last_used_counter = $2, enrolled_at = COALESCE(enrolled_at, now()) WHERE user_id = $1', [info.user.id, v.counter]));
    await markMfaVerified(info.session.id);
    const refreshed = await resolveSession(req.cookies[config.cookieName]);
    const csrf = await rotateCsrf(info.session.id);
    await withServiceTx((tx) =>
      tx.query(`INSERT INTO public.audit_events (org_id, actor_id, actor_role, action, target_type, target_id, request_id) VALUES ($1, $2, $3, $4, 'session', $5, $6)`, [info.session.org_id, info.user.id, info.role, mode === 'enroll' ? 'auth.mfa_enrolled' : mode === 'verify' ? 'auth.login' : 'auth.step_up', info.session.id, req.id]),
    );
    return ok(req, reply, sessionInfo(refreshed, csrf));
  };

  app.post('/api/auth/mfa/enroll/confirm', { config: { auth: { allowMfaPending: true }, rateLimit: { max: 10, timeWindow: '1 minute' } } }, verifyHandler('enroll'));
  app.post('/api/auth/mfa/verify', { config: { auth: { allowMfaPending: true }, rateLimit: { max: 10, timeWindow: '1 minute' } } }, verifyHandler('verify'));
  app.post('/api/auth/step-up', { config: { auth: {}, rateLimit: { max: 10, timeWindow: '1 minute' } } }, verifyHandler('step_up'));

  app.post('/api/auth/logout', { config: { auth: { allowMfaPending: true } } }, async (req, reply) => {
    const info = req.sessionInfo!;
    await revokeSession(info.session.id);
    await withServiceTx((tx) =>
      tx.query(`INSERT INTO public.audit_events (org_id, actor_id, actor_role, action, target_type, target_id, request_id) VALUES ($1, $2, $3, 'auth.logout', 'session', $4, $5)`, [info.session.org_id, info.user.id, info.role, info.session.id, req.id]),
    );
    void reply.clearCookie(config.cookieName, { path: '/' });
    return ok(req, reply, { ok: true });
  });
}
