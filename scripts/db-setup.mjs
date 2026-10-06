// 開発用: DATABASE_URL のデータベースが無ければ作成してから migrate
import pg from 'pg';
import { adminUrl } from './db-lib.mjs';

const url = new URL(adminUrl());
const dbName = url.pathname.replace(/^\//, '') || 'postgres';
const maint = new URL(url.toString());
maint.pathname = '/postgres';
const c = new pg.Client({ connectionString: maint.toString() });
await c.connect();
const exists = await c.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
if (exists.rowCount === 0) {
  await c.query(`CREATE DATABASE "${dbName.replace(/"/g, '""')}" ENCODING 'UTF8' TEMPLATE template0`);
  console.log(`created database ${dbName}`);
}
await c.end();
await import('./db-migrate.mjs');
