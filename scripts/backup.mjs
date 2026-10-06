// 日次バックアップ（管理者向け）: pg_dump（custom 形式）+ blobs + 書式/フォント/renderer 設定を 1 つのディレクトリへ。
// 暗号化は運用側（例: age / gpg）で行い、別権限の保管先へ移す。RPO 24h / RTO 1 営業日は目標であり保証契約ではない。
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, adminUrl } from './db-lib.mjs';

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const out = path.resolve(process.argv[2] ?? path.join(ROOT, '.data', 'backups', stamp));
fs.mkdirSync(out, { recursive: true });
const dump = path.join(out, 'db.dump');
const r = spawnSync('pg_dump', ['--format=custom', '--no-owner', '--file', dump, adminUrl()], { stdio: 'inherit' });
if (r.status !== 0) {
  console.error('pg_dump failed');
  process.exit(1);
}
const blobDir = process.env.BLOB_LOCAL_DIR ? path.resolve(ROOT, process.env.BLOB_LOCAL_DIR) : path.join(ROOT, '.data', 'blobs');
if (fs.existsSync(blobDir)) fs.cpSync(blobDir, path.join(out, 'blobs'), { recursive: true });
for (const d of ['templates/demo', 'assets/fonts', 'supabase/migrations']) if (fs.existsSync(path.join(ROOT, d))) fs.cpSync(path.join(ROOT, d), path.join(out, d), { recursive: true });
const manifest = { createdAt: new Date().toISOString(), db: 'db.dump (pg_dump custom)', blobs: fs.existsSync(blobDir) ? 'blobs/' : null, note: '復元は scripts/restore.mjs（空環境限定）。添付と DB の片方だけの復元は完了扱いにしない。' };
fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`backup written: ${out}`);
