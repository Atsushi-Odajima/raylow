import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { config } from '../config.js';
import type { Actor } from '../db/pool.js';
import { ApiError, forbidden, mfaRequired, unauthorized } from '../errors.js';
import { csrfMatches, mfaRecent, resolveSession, type ResolvedSession } from '../auth/session.js';

declare module 'fastify' {
  interface FastifyRequest {
    sessionInfo: ResolvedSession | null;
    actor: Actor | null;
    requestId: string;
  }
}

export interface AuthOptions {
  /** 認証不要 */
  public?: boolean;
  /** MFA 未完了でも許可（MFA 画面用） */
  allowMfaPending?: boolean;
  /** 重要操作: MFA 15 分以内 */
  requireRecentMfa?: boolean;
  roles?: Array<'admin' | 'lawyer' | 'staff'>;
}

declare module 'fastify' {
  interface FastifyContextConfig {
    auth?: AuthOptions;
  }
}

function originAllowed(req: FastifyRequest): boolean {
  const origin = req.headers.origin;
  if (origin) return config.allowedOrigins.includes(origin);
  // Origin が無い場合は Referer で判定。どちらも無い非 GET は拒否（ブラウザ以外の呼出は許可しない設計）
  const referer = req.headers.referer;
  if (referer) {
    try {
      const u = new URL(referer);
      return config.allowedOrigins.includes(u.origin);
    } catch {
      return false;
    }
  }
  return false;
}

export const authPlugin = fp(async (app: FastifyInstance) => {
  app.decorateRequest('sessionInfo', null);
  app.decorateRequest('actor', null);
  app.decorateRequest('requestId', '');

  app.addHook('onRequest', async (req: FastifyRequest) => {
    req.requestId = req.id;
  });

  app.addHook('preHandler', async (req: FastifyRequest, _reply: FastifyReply) => {
    // API は必ず /api 配下。それ以外（WEB_DIST_DIR の静的配信・SPA fallback・404）は認証/CSRF の対象外
    const pathname = req.url.split('?')[0] ?? '';
    if (pathname !== '/api' && !pathname.startsWith('/api/')) return;
    const opts: AuthOptions = req.routeOptions.config.auth ?? {};
    const cookie = req.cookies[config.cookieName];
    const info = await resolveSession(cookie);
    req.sessionInfo = info;
    if (info) {
      req.actor = { userId: info.user.id, orgId: info.session.org_id, role: info.role, requestId: req.requestId };
    }
    const method = req.method.toUpperCase();
    const mutating = method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS';
    if (mutating && !originAllowed(req)) {
      throw new ApiError(403, 'origin_not_allowed', 'Origin が許可されていません');
    }
    if (opts.public) return;
    if (!info) throw unauthorized();
    if (mutating) {
      const token = req.headers['x-csrf-token'];
      if (typeof token !== 'string' || !csrfMatches(info.session, token)) {
        throw new ApiError(403, 'csrf_failed', 'CSRF トークンが一致しません。画面を再読込してください');
      }
    }
    if (info.session.mfa_pending && !opts.allowMfaPending) throw mfaRequired();
    if (opts.requireRecentMfa && !mfaRecent(info.session)) {
      throw new ApiError(401, 'mfa_required', 'この操作には多要素認証の再確認が必要です（15分以内）');
    }
    if (opts.roles && !opts.roles.includes(info.role)) throw forbidden();
  });
});

export function requireActor(req: FastifyRequest): Actor {
  if (!req.actor) throw unauthorized();
  return req.actor;
}
