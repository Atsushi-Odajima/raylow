/** vitest globalSetup: テスト DB を作り直し、migrate + seed を実行する（別プロセス）。 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import './env.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export default async function setup(): Promise<void> {
  if (process.env.RAYLOW_TEST_SKIP_DB_SETUP === 'true') return;
  for (const d of ['.data/test-blobs', '.data/test-tmp']) fs.rmSync(path.join(root, d), { recursive: true, force: true });
  fs.rmSync(path.join(root, '.data/test-seed-credentials.json'), { force: true });
  const env = { ...process.env };
  const r = spawnSync(process.execPath, [path.join(root, 'scripts', 'db-reset.mjs')], { env, stdio: 'pipe', encoding: 'utf8' });
  if (r.status !== 0) {
    throw new Error(`test DB setup failed:\n${r.stdout}\n${r.stderr}`);
  }
  if (!fs.existsSync(path.join(root, '.data/test-seed-credentials.json'))) throw new Error('seed credentials not written');
}
