// 復元（空環境限定）: scripts/backup.mjs の出力ディレクトリから DB と blobs を復元し、hash を検証する。
// usage: node scripts/restore.mjs <backup-dir>
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { ROOT, adminUrl } from './db-lib.mjs';

const dir = process.argv[2];
if (!dir) {
  console.error('usage: node scripts/restore.mjs <backup-dir>');
  process.exit(2);
}
const dump = path.join(dir, 'db.dump');
if (!fs.existsSync(dump)) {
  console.error('db.dump がありません');
  process.exit(2);
}
const client = new pg.Client({ connectionString: adminUrl() });
await client.connect();
const tables = await client.query(`SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public' AND table_name NOT IN ('_raylow_migrations')`);
const rows = tables.rows[0].n > 0 ? await client.query(`SELECT (SELECT count(*) FROM public.organizations) AS n`).catch(() => ({ rows: [{ n: 0 }] })) : { rows: [{ n: 0 }] };
if (Number(rows.rows[0].n) > 0) {
  console.error('復元先が空ではありません（organizations にデータあり）。空の DB を用意してください');
  await client.end();
  process.exit(1);
}
await client.end();
const r = spawnSync('pg_restore', ['--no-owner', '--clean', '--if-exists', '--dbname', adminUrl(), dump], { stdio: 'inherit' });
if (r.status !== 0) {
  console.error('pg_restore failed');
  process.exit(1);
}
const blobSrc = path.join(dir, 'blobs');
const blobDir = process.env.BLOB_LOCAL_DIR ? path.resolve(ROOT, process.env.BLOB_LOCAL_DIR) : path.join(ROOT, '.data', 'blobs');
if (fs.existsSync(blobSrc)) {
  if (fs.existsSync(blobDir) && fs.readdirSync(blobDir).length > 0) {
    console.error('blob ディレクトリが空ではありません');
    process.exit(1);
  }
  fs.cpSync(blobSrc, blobDir, { recursive: true });
}
// hash 検証: file_versions.sha256 と blob の実体
const c2 = new pg.Client({ connectionString: adminUrl() });
await c2.connect();
const fv = await c2.query('SELECT storage_key, sha256 FROM public.file_versions');
let ok = 0;
let bad = 0;
for (const v of fv.rows) {
  const p = path.join(blobDir, v.storage_key.slice(0, 2), v.storage_key);
  if (!fs.existsSync(p)) { bad++; console.error(`missing blob ${v.storage_key}`); continue; }
  const h = createHash('sha256').update(fs.readFileSync(p)).digest('hex');
  if (h !== v.sha256) { bad++; console.error(`hash mismatch ${v.storage_key}`); } else ok++;
}
const acl = await c2.query('SELECT (SELECT count(*) FROM public.matter_members) AS members, (SELECT count(*) FROM public.matter_barriers) AS barriers, (SELECT count(*) FROM public.memberships) AS memberships');
await c2.end();
console.log(`restore: blobs ok=${ok} bad=${bad}; ACL rows: ${JSON.stringify(acl.rows[0])}`);
if (bad > 0) {
  console.error('添付と DB の整合が取れていないため復元は未完了です');
  process.exit(1);
}
console.log('restore complete (DB + blobs + hash verified)');
