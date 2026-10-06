// 開発用: DB を破棄して再作成し migrate + seed（本番で使わない）
import pg from 'pg';
import { adminUrl } from './db-lib.mjs';

if (process.env.NODE_ENV === 'production') throw new Error('db:reset は本番で実行できません');
const url = new URL(adminUrl());
const dbName = url.pathname.replace(/^\//, '');
const maint = new URL(url.toString());
maint.pathname = '/postgres';
const c = new pg.Client({ connectionString: maint.toString() });
await c.connect();
await c.query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`, [dbName]);
await c.query(`DROP DATABASE IF EXISTS "${dbName.replace(/"/g, '""')}"`);
await c.query(`CREATE DATABASE "${dbName.replace(/"/g, '""')}" ENCODING 'UTF8' TEMPLATE template0`);
await c.end();
console.log(`recreated database ${dbName}`);
await import('./db-migrate.mjs');
await import('./db-seed.mjs');
