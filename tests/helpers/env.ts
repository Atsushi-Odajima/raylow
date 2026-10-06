/**
 * テスト用環境（setupFiles）。config モジュールの import 前に環境変数を固定する。
 * テスト DB: raylow_test（global-setup で作成・migrate・seed）。
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
dotenv.config({ path: path.join(root, '.env') });

const base = new URL(process.env.DATABASE_URL ?? 'postgresql://postgres@127.0.0.1:54329/raylow');
const admin = new URL(base.toString());
admin.pathname = '/raylow_test';
const app = new URL(process.env.DATABASE_URL_APP ?? 'postgresql://authenticator:devauthpw@127.0.0.1:54329/raylow');
app.pathname = '/raylow_test';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = admin.toString();
process.env.DATABASE_URL_APP = app.toString();
process.env.DATABASE_URL_SERVICE = app.toString();
process.env.BLOB_LOCAL_DIR = '.data/test-blobs';
process.env.RENDER_TMP_DIR = '.data/test-tmp';
process.env.DEV_ALLOW_UNSCANNED = 'true';
process.env.SEED_CREDENTIALS_PATH = '.data/test-seed-credentials.json';
process.env.LOG_LEVEL = 'warn';
process.env.ALLOWED_ORIGINS = 'http://localhost:5173';
process.env.AUTH_PROVIDER = 'local';
process.env.BLOB_STORE = 'local';
process.env.COOKIE_SECURE = 'false';

export const TEST_ROOT = root;
