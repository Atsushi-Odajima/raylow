import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { z } from 'zod';

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(here, '..', '..', '..');
dotenv.config({ path: path.join(REPO_ROOT, '.env') });

const Env = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL_SERVICE: z.string().min(1),
  WORKER_ID: z.string().default(''),
  SOFFICE_BIN: z.string().default('soffice'),
  FONTS_DIR: z.string().default('./assets/fonts'),
  PYTHON_BIN: z.string().default('python3'),
  DOCUMENT_WORKER_DIR: z.string().default('./workers/documents'),
  RENDER_TMP_DIR: z.string().default('.data/tmp'),
  BLOB_STORE: z.enum(['local', 'supabase']).default('local'),
  BLOB_LOCAL_DIR: z.string().default('.data/blobs'),
  SUPABASE_URL: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  SUPABASE_STORAGE_BUCKET: z.string().default('raylow-private'),
  CLAMD_HOST: z.string().default(''),
  CLAMD_PORT: z.coerce.number().int().default(3310),
  DEV_ALLOW_UNSCANNED: z.string().default('false'),
  LOG_LEVEL: z.string().default('info'),
  WORKER_POLL_MS: z.coerce.number().int().default(1000),
});
const p = Env.safeParse(process.env);
if (!p.success) throw new Error('worker 環境変数が不足: ' + p.error.issues.map((i) => i.path.join('.')).join(', '));
const e = p.data;
const abs = (x: string) => (path.isAbsolute(x) ? x : path.join(REPO_ROOT, x));
export const config = {
  env: e.NODE_ENV,
  dbUrl: e.DATABASE_URL_SERVICE,
  workerId: e.WORKER_ID || `${os.hostname()}-${process.pid}`,
  soffice: e.SOFFICE_BIN,
  fontsDir: abs(e.FONTS_DIR),
  python: e.PYTHON_BIN,
  documentWorkerDir: abs(e.DOCUMENT_WORKER_DIR),
  tmpDir: abs(e.RENDER_TMP_DIR),
  blobStore: e.BLOB_STORE,
  blobLocalDir: abs(e.BLOB_LOCAL_DIR),
  supabase: { url: e.SUPABASE_URL ?? '', serviceKey: e.SUPABASE_SERVICE_ROLE_KEY ?? '', bucket: e.SUPABASE_STORAGE_BUCKET },
  clamd: e.CLAMD_HOST ? { host: e.CLAMD_HOST, port: e.CLAMD_PORT } : null,
  devAllowUnscanned: e.DEV_ALLOW_UNSCANNED === 'true' && e.NODE_ENV !== 'production',
  logLevel: e.LOG_LEVEL,
  pollMs: e.WORKER_POLL_MS,
  rendererVersion: 'raylow-render/1.0.0;docxtemplater@3.71.0;pizzip@3.3.0',
} as const;
