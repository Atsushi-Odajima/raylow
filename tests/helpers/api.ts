/** in-process API クライアント（Fastify inject）。cookie / CSRF / MFA を扱う。 */
import fs from 'node:fs';
import path from 'node:path';
import * as OTPAuth from 'otpauth';
import type { FastifyInstance, InjectOptions } from 'fastify';
import { TEST_ROOT } from './env.js';

export interface SeedCreds {
  users: Array<{ key: string; email: string; role: string; org: string; password: string; totpSecret: string }>;
  ids: { orgs: Record<string, string>; matters: Record<string, string>; contacts: Record<string, string>; lawyers: Record<string, string> };
}

export function seedCreds(): SeedCreds {
  return JSON.parse(fs.readFileSync(path.join(TEST_ROOT, '.data', 'test-seed-credentials.json'), 'utf8')) as SeedCreds;
}

let appPromise: Promise<FastifyInstance> | null = null;
export async function getApp(): Promise<FastifyInstance> {
  if (!appPromise) {
    appPromise = (async () => {
      const { buildApp } = await import('../../apps/api/src/app.js');
      const app = await buildApp();
      await app.ready();
      return app;
    })();
  }
  return appPromise;
}

export class ApiClient {
  cookie = '';
  csrf = '';
  constructor(private readonly app: FastifyInstance, readonly origin = 'http://localhost:5173') {}

  async raw(method: InjectOptions['method'], url: string, body?: unknown, headers: Record<string, string> = {}, payloadRaw?: Buffer | string) {
    const h: Record<string, string> = { origin: this.origin, ...headers };
    if (this.cookie) h.cookie = this.cookie;
    if (this.csrf) h['x-csrf-token'] = this.csrf;
    const opts: InjectOptions = { method, url, headers: h };
    if (payloadRaw !== undefined) opts.payload = payloadRaw;
    else if (body !== undefined) {
      h['content-type'] = 'application/json';
      opts.payload = JSON.stringify(body);
    }
    const res = await this.app.inject(opts);
    const sc = res.headers['set-cookie'];
    const first = Array.isArray(sc) ? sc[0] : sc;
    if (first) this.cookie = first.split(';')[0]!;
    const hc = res.headers['x-csrf-token'];
    if (typeof hc === 'string') this.csrf = hc;
    return res;
  }

  async call<T = unknown>(method: InjectOptions['method'], url: string, body?: unknown): Promise<{ status: number; data: T; error: { code: string; message: string; fieldErrors?: unknown[]; currentVersion?: number } | null; json: unknown }> {
    const res = await this.raw(method, url, body);
    let json: unknown = null;
    try {
      json = res.json();
    } catch {
      json = null;
    }
    const j = json as { data?: T; error?: { code: string; message: string } } | null;
    if (j?.data && typeof j.data === 'object' && j.data !== null && 'csrfToken' in (j.data as object) && typeof (j.data as { csrfToken: unknown }).csrfToken === 'string') this.csrf = (j.data as { csrfToken: string }).csrfToken;
    return { status: res.statusCode, data: (j?.data as T) ?? (undefined as unknown as T), error: j?.error ?? null, json };
  }

  async expectOk<T = unknown>(method: InjectOptions['method'], url: string, body?: unknown): Promise<T> {
    const r = await this.call<T>(method, url, body);
    if (r.status >= 400) throw new Error(`${method} ${url} -> ${r.status} ${JSON.stringify(r.json)}`);
    return r.data;
  }

  async login(userKey: string): Promise<void> {
    const u = seedCreds().users.find((x) => x.key === userKey);
    if (!u) throw new Error(`unknown seed user ${userKey}`);
    const l = await this.call('POST', '/api/auth/login', { email: u.email, password: u.password });
    if (l.status !== 200) throw new Error(`login failed ${l.status} ${JSON.stringify(l.json)}`);
    const totp = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(u.totpSecret), digits: 6, period: 30 });
    let v = await this.call('POST', '/api/auth/mfa/verify', { code: totp.generate() });
    if (v.status === 401) {
      // 同一 30 秒内の TOTP 再利用は拒否される（仕様どおり）。次の時刻ステップまで待って再試行する
      const wait = (30 - (Math.floor(Date.now() / 1000) % 30)) * 1000 + 500;
      await new Promise((r) => setTimeout(r, wait));
      v = await this.call('POST', '/api/auth/mfa/verify', { code: totp.generate() });
    }
    if (v.status !== 200) throw new Error(`mfa failed ${v.status} ${JSON.stringify(v.json)}`);
  }
}

export async function loginAs(userKey: string): Promise<ApiClient> {
  const c = new ApiClient(await getApp());
  await c.login(userKey);
  return c;
}

/** worker をプロセス内で実行してキューを空にする */
export async function drainJobs(): Promise<number> {
  const w = await import('../../apps/worker/src/worker.js');
  return w.drainQueue(200);
}

export async function waitJob(client: ApiClient, jobId: string, timeoutMs = 120_000): Promise<{ state: string; errorCode: string | null; errorMessage: string | null; result: Record<string, unknown> | null }> {
  const started = Date.now();
  for (;;) {
    await drainJobs();
    const j = await client.expectOk<{ state: string; errorCode: string | null; errorMessage: string | null; result: Record<string, unknown> | null }>('GET', `/api/jobs/${jobId}`);
    if (j.state === 'succeeded' || j.state === 'failed' || j.state === 'cancelled') return j;
    if (Date.now() - started > timeoutMs) throw new Error(`job ${jobId} timeout (${j.state})`);
    await new Promise((r) => setTimeout(r, 200));
  }
}

/** service_role で直接 SQL（テスト準備用） */
export async function sql<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  const { withServiceTx } = await import('../../apps/api/src/db/pool.js');
  return withServiceTx(async (tx) => (await tx.query<T>(text, params)).rows);
}

/** RLS 検証用: authenticated ロール + claims で SQL */
export async function sqlAs<T = Record<string, unknown>>(userId: string, text: string, params: unknown[] = []): Promise<T[]> {
  const { withUserTx } = await import('../../apps/api/src/db/pool.js');
  return withUserTx({ userId, orgId: '', role: 'lawyer', requestId: 'test' }, async (tx) => (await tx.query<T>(text, params)).rows);
}

export function userId(key: string): string {
  // seed には user id が無いので email から引く
  return key;
}
