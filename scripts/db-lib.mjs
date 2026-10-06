// 共通: 環境変数読み込みと接続文字列解析
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(root, '.env') });

export const ROOT = root;
export const MIGRATIONS_DIR = path.join(root, 'supabase', 'migrations');

export function adminUrl() {
  const u = process.env.DATABASE_URL;
  if (!u) throw new Error('DATABASE_URL が未設定です（.env.example を .env にコピーして設定）');
  return u;
}

export function listMigrations() {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => ({ name: f, sql: fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8') }));
}
