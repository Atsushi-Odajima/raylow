import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { z } from 'zod';

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(here, '..', '..', '..');
dotenv.config({ path: path.join(REPO_ROOT, '.env') });

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  RAYLOW_PUBLIC_ORIGIN: z.string().url().default('http://localhost:5173'),
  DATABASE_URL_APP: z.string().min(1),
  DATABASE_URL_SERVICE: z.string().min(1),
  AUTH_PROVIDER: z.enum(['local', 'supabase']).default('local'),
  SUPABASE_URL: z.string().optional(),
  SUPABASE_ANON_KEY: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  SESSION_ENCRYPTION_KEY: z.string().min(40),
  ALLOWED_ORIGINS: z.string().default('http://localhost:5173'),
  COOKIE_SECURE: z.string().default('false'),
  BLOB_STORE: z.enum(['local', 'supabase']).default('local'),
  BLOB_LOCAL_DIR: z.string().default('.data/blobs'),
  SUPABASE_STORAGE_BUCKET: z.string().default('raylow-private'),
  API_PORT: z.coerce.number().int().default(3001),
  API_HOST: z.string().default('127.0.0.1'),
  DEV_ALLOW_UNSCANNED: z.string().default('false'),
  LOG_LEVEL: z.string().default('info'),
});

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n');
  throw new Error(`環境変数が不足しています。.env.example を参照してください:\n${msg}`);
}
const env = parsed.data;

export const config = {
  env: env.NODE_ENV,
  isProd: env.NODE_ENV === 'production',
  publicOrigin: env.RAYLOW_PUBLIC_ORIGIN,
  dbAppUrl: env.DATABASE_URL_APP,
  dbServiceUrl: env.DATABASE_URL_SERVICE,
  authProvider: env.AUTH_PROVIDER,
  supabase: { url: env.SUPABASE_URL ?? '', anonKey: env.SUPABASE_ANON_KEY ?? '', serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY ?? '', bucket: env.SUPABASE_STORAGE_BUCKET },
  sessionKey: Buffer.from(env.SESSION_ENCRYPTION_KEY, 'base64'),
  allowedOrigins: env.ALLOWED_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean),
  cookieSecure: env.COOKIE_SECURE === 'true',
  blobStore: env.BLOB_STORE,
  blobLocalDir: path.isAbsolute(env.BLOB_LOCAL_DIR) ? env.BLOB_LOCAL_DIR : path.join(REPO_ROOT, env.BLOB_LOCAL_DIR),
  port: env.API_PORT,
  host: env.API_HOST,
  devAllowUnscanned: env.DEV_ALLOW_UNSCANNED === 'true' && env.NODE_ENV !== 'production',
  logLevel: env.LOG_LEVEL,
  cookieName: 'raylow_sid',
} as const;

if (config.sessionKey.length !== 32) {
  throw new Error('SESSION_ENCRYPTION_KEY は 32byte の base64 である必要があります');
}
