/**
 * web(dist) の同一 origin 配信（単一コンテナ配備用。WEB_DIST_DIR 設定時のみ）。
 * - /api/* 以外に CSP 等のセキュリティヘッダを付ける（infra/caddy/Caddyfile と同じ方針）
 * - ハッシュ付き /assets は長期 cache、sw.js / manifest / index.html は no-cache
 * - SPA fallback: HTML を要求する GET/HEAD の未知パスは index.html を返す（/api は JSON 404 のまま）
 */
import fs from 'node:fs';
import path from 'node:path';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';

export const CONTENT_SECURITY_POLICY =
  "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; font-src 'self'; connect-src 'self'; worker-src 'self' blob:; frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'";
const NO_CACHE_PATHS = new Set(['/sw.js', '/manifest.webmanifest', '/index.html', '/offline.html']);

export function notFoundBody(requestId: string): { error: { code: string; message: string; fieldErrors: never[]; requestId: string } } {
  return { error: { code: 'not_found', message: '見つかりません', fieldErrors: [], requestId } };
}

export async function registerWebStatic(app: FastifyInstance, distDir: string, opts: { hsts: boolean }): Promise<void> {
  if (!fs.existsSync(path.join(distDir, 'index.html'))) {
    throw new Error(`WEB_DIST_DIR に index.html がありません: ${distDir}（npm run build -w apps/web を先に実行）`);
  }
  await app.register(fastifyStatic, {
    root: distDir,
    prefix: '/',
    index: false,
    wildcard: false,
    // @fastify/static 10 は reply（FastifyReply）を渡す
    setHeaders(reply, filePath) {
      const rel = '/' + path.relative(distDir, filePath).split(path.sep).join('/');
      if (rel.startsWith('/assets/')) reply.header('Cache-Control', 'public, max-age=31536000, immutable');
      else if (NO_CACHE_PATHS.has(rel)) reply.header('Cache-Control', 'no-cache');
      else reply.header('Cache-Control', 'public, max-age=3600');
    },
  });

  app.addHook('onSend', async (req, reply, payload) => {
    if (req.url.startsWith('/api/')) return payload;
    reply.header('Content-Security-Policy', CONTENT_SECURITY_POLICY);
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('X-Frame-Options', 'DENY');
    if (opts.hsts) reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    return payload;
  });

  app.setNotFoundHandler((req, reply) => {
    const wantsHtml = (req.headers.accept ?? '').includes('text/html');
    if ((req.method === 'GET' || req.method === 'HEAD') && !req.url.startsWith('/api/') && wantsHtml) {
      void reply.header('Cache-Control', 'no-cache').sendFile('index.html');
      return;
    }
    void reply.status(404).send(notFoundBody(req.id));
  });
}
