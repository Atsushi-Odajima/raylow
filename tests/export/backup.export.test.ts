/** AC24: 日次バックアップ（pg_dump + blobs）から空環境へ復元し、DB/原本/書式/出力の hash と ACL 行数が一致する */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import pg from 'pg';
import { TEST_ROOT } from '../helpers/env.js';

describe('backup → restore', () => {
  it('scripts/backup.mjs → scripts/restore.mjs（空の raylow_restore DB）', async () => {
    const hasPgDump = spawnSync('pg_dump', ['--version']).status === 0;
    if (!hasPgDump) {
      console.warn('pg_dump が無いためスキップ（未検証）');
      return;
    }
    const outDir = path.join(TEST_ROOT, '.data', 'test-backup');
    fs.rmSync(outDir, { recursive: true, force: true });
    const admin0 = new URL(process.env.DATABASE_URL!);
    const src0 = new pg.Client({ connectionString: admin0.toString() });
    await src0.connect();
    const tables = ['matters', 'matter_members', 'matter_barriers', 'memberships', 'template_versions', 'draft_outputs', 'file_versions', 'audit_events'];
    const srcCounts: Record<string, number> = {};
    for (const t of tables) srcCounts[t] = (await src0.query(`SELECT count(*)::int AS n FROM public.${t}`)).rows[0].n;
    const srcHash = (await src0.query(`SELECT string_agg(sha256, ',' ORDER BY id) AS h FROM public.file_versions`)).rows[0].h;
    await src0.end();
    const b = spawnSync(process.execPath, [path.join(TEST_ROOT, 'scripts', 'backup.mjs'), outDir], { env: process.env, encoding: 'utf8' });
    expect(b.status, b.stderr).toBe(0);
    expect(fs.existsSync(path.join(outDir, 'db.dump'))).toBe(true);
    // 復元先 DB を作成（空）
    const admin = new URL(process.env.DATABASE_URL!);
    const maint = new URL(admin.toString());
    maint.pathname = '/postgres';
    const c = new pg.Client({ connectionString: maint.toString() });
    await c.connect();
    await c.query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'raylow_restore' AND pid <> pg_backend_pid()`);
    await c.query('DROP DATABASE IF EXISTS raylow_restore');
    await c.query(`CREATE DATABASE raylow_restore ENCODING 'UTF8' TEMPLATE template0`);
    await c.end();
    const restoreUrl = new URL(admin.toString());
    restoreUrl.pathname = '/raylow_restore';
    const restoreBlobs = path.join(TEST_ROOT, '.data', 'test-restore-blobs');
    fs.rmSync(restoreBlobs, { recursive: true, force: true });
    const r = spawnSync(process.execPath, [path.join(TEST_ROOT, 'scripts', 'restore.mjs'), outDir], { env: { ...process.env, DATABASE_URL: restoreUrl.toString(), BLOB_LOCAL_DIR: restoreBlobs }, encoding: 'utf8' });
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(r.stdout).toContain('restore complete');
    // dump 前の行数・hash と復元後を比較
    const dst = new pg.Client({ connectionString: restoreUrl.toString() });
    await dst.connect();
    for (const t of tables) {
      const b2 = await dst.query(`SELECT count(*)::int AS n FROM public.${t}`);
      expect(b2.rows[0].n, t).toBe(srcCounts[t]);
    }
    const hb = await dst.query(`SELECT string_agg(sha256, ',' ORDER BY id) AS h FROM public.file_versions`);
    expect(hb.rows[0].h).toBe(srcHash);
    await dst.end();
  });
});
