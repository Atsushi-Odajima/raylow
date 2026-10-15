import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import { randomUUID } from 'node:crypto';
import { ZodError } from 'zod';
import { config } from './config.js';
import { ApiError } from './errors.js';
import { authPlugin } from './plugins/auth.js';
import { notFoundBody, registerWebStatic } from './plugins/web.js';
import { registerRoutes } from './routes/index.js';

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: config.logLevel, redact: ['req.headers.cookie', 'req.headers.authorization', 'req.headers["x-csrf-token"]'] },
    genReqId: () => randomUUID(),
    bodyLimit: 2 * 1024 * 1024,
    trustProxy: true,
    disableRequestLogging: config.env === 'test',
  });

  await app.register(cookie, { hook: 'onRequest' });
  await app.register(multipart, { limits: { fileSize: 100 * 1024 * 1024, files: 1, fields: 10 } });
  await app.register(rateLimit, { global: false });
  await app.register(authPlugin);

  // 機密 API は cache しない
  app.addHook('onSend', async (req, reply, payload) => {
    if (req.url.startsWith('/api/')) {
      reply.header('Cache-Control', 'no-store');
      reply.header('X-Content-Type-Options', 'nosniff');
      reply.header('Referrer-Policy', 'no-referrer');
      reply.header('X-Request-Id', req.id);
    }
    return payload;
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ApiError) {
      void reply.status(err.status).send({
        error: { code: err.code, message: err.message, fieldErrors: err.fieldErrors, requestId: req.id, ...(err.currentVersion !== undefined ? { currentVersion: err.currentVersion } : {}), ...(err.details ? { details: err.details } : {}) },
      });
      return;
    }
    if (err instanceof ZodError) {
      void reply.status(422).send({ error: { code: 'validation_failed', message: '入力内容を確認してください', fieldErrors: err.issues.map((i) => ({ field: i.path.join('.'), code: i.code, message: i.message })), requestId: req.id } });
      return;
    }
    const e = err as { statusCode?: number; code?: string; message?: string };
    if (e.statusCode === 429) {
      void reply.status(429).send({ error: { code: 'rate_limited', message: '試行回数が多すぎます', fieldErrors: [], requestId: req.id } });
      return;
    }
    if (e.statusCode === 413 || e.code === 'FST_REQ_FILE_TOO_LARGE' || e.code === 'FST_ERR_CTP_BODY_TOO_LARGE') {
      void reply.status(413).send({ error: { code: 'payload_too_large', message: 'ファイルまたは本文が大きすぎます', fieldErrors: [], requestId: req.id } });
      return;
    }
    if (e.statusCode === 415 || e.code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE') {
      void reply.status(415).send({ error: { code: 'unsupported_media_type', message: '対応していない形式です', fieldErrors: [], requestId: req.id } });
      return;
    }
    if (e.statusCode === 400 && e.code && e.code.startsWith('FST_')) {
      void reply.status(422).send({ error: { code: 'validation_failed', message: e.message ?? 'リクエストが不正です', fieldErrors: [], requestId: req.id } });
      return;
    }
    // DB 制約由来
    const pgCode = (err as { code?: string }).code;
    if (pgCode === '23505') {
      void reply.status(409).send({ error: { code: 'conflict', message: '同じ値が既に存在します', fieldErrors: [], requestId: req.id } });
      return;
    }
    if (pgCode === '23514' || pgCode === '23503') {
      const m = (err as Error).message;
      if (m.includes('cross_org_reference')) {
        void reply.status(404).send({ error: { code: 'not_found', message: '見つからないか、権限がありません', fieldErrors: [], requestId: req.id } });
        return;
      }
      void reply.status(409).send({ error: { code: 'conflict', message: '状態または参照の整合性に違反します', fieldErrors: [], requestId: req.id, details: { constraint: m.split(':')[0] } } });
      return;
    }
    if (pgCode === '42501') {
      req.log.warn({ requestId: req.id, dbMessage: (err as Error).message }, 'rls denied');
      void reply.status(404).send({ error: { code: 'not_found', message: '見つからないか、権限がありません', fieldErrors: [], requestId: req.id, ...(config.isProd ? {} : { details: { dbMessage: (err as Error).message } }) } });
      return;
    }
    req.log.error({ err, requestId: req.id }, 'unhandled error');
    // 内部 stacktrace は返さない
    void reply.status(500).send({ error: { code: 'internal_error', message: '内部エラーが発生しました。requestId を添えて管理者へ連絡してください', fieldErrors: [], requestId: req.id } });
  });

  await registerRoutes(app);

  // WEB_DIST_DIR 設定時は web(dist) を同一 origin で配信（単一コンテナ配備）。未設定なら 404 は JSON
  if (config.webDistDir) {
    await registerWebStatic(app, config.webDistDir, { hsts: config.cookieSecure });
  } else {
    app.setNotFoundHandler((req, reply) => {
      void reply.status(404).send(notFoundBody(req.id));
    });
  }
  return app;
}
