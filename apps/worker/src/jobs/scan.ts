/**
 * scan_file: magic/MIME/構造検査（Python）+ ClamAV（clamd INSTREAM）。scanner 停止は fail closed（scan_failed, retryable）。
 * PDF は派生安全版（safe_preview）を生成する。
 */
import net from 'node:net';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Tx } from '../db.js';
import { blobStore, sha256Hex } from '../blobs.js';
import { config } from '../config.js';
import { runPython, ToolError } from '../python.js';
import { JobFailure, type JobContext } from './types.js';
import { inspectDocxBytes } from './inspect.js';

type Row = Record<string, unknown>;

async function clamdScan(bytes: Buffer): Promise<{ status: 'clean' | 'infected' | 'unavailable'; signature?: string }> {
  if (!config.clamd) return { status: 'unavailable' };
  const { host, port } = config.clamd;
  return new Promise((resolve) => {
    const sock = net.createConnection({ host, port });
    let out = '';
    const done = (r: { status: 'clean' | 'infected' | 'unavailable'; signature?: string }) => { sock.destroy(); resolve(r); };
    sock.setTimeout(120_000, () => done({ status: 'unavailable' }));
    sock.on('error', () => done({ status: 'unavailable' }));
    sock.on('connect', () => {
      sock.write('zINSTREAM\0');
      const chunk = 64 * 1024;
      for (let i = 0; i < bytes.length; i += chunk) {
        const c = bytes.subarray(i, i + chunk);
        const len = Buffer.alloc(4);
        len.writeUInt32BE(c.length, 0);
        sock.write(len);
        sock.write(c);
      }
      sock.write(Buffer.from([0, 0, 0, 0]));
    });
    sock.on('data', (d) => (out += d.toString()));
    sock.on('end', () => {
      if (/: OK/.test(out)) done({ status: 'clean' });
      else if (/FOUND/.test(out)) done({ status: 'infected', signature: out.trim() });
      else done({ status: 'unavailable' });
    });
  });
}

export async function scanFileJob(ctx: JobContext, tx: Tx): Promise<Record<string, unknown>> {
  const p = ctx.job.payload as { fileId: string; fileVersionId: string; mime: string; originalName: string; devAllowUnscanned?: boolean };
  const f = await tx.query<Row>('SELECT * FROM public.files WHERE id = $1 FOR UPDATE', [p.fileId]);
  const file = f.rows[0];
  if (!file) throw new JobFailure('not_found', 'ファイルが見つかりません', false);
  if (file.org_id !== ctx.job.org_id) throw new JobFailure('scope_mismatch', 'org 不一致', false);
  await tx.query(`UPDATE public.files SET scan_status = 'scanning' WHERE id = $1`, [p.fileId]);
  const bytes = await blobStore.get(file.storage_key as string);
  if (sha256Hex(bytes) !== file.sha256) throw new JobFailure('hash_mismatch', '保存 bytes の hash が登録値と異なります', false);
  const dir = path.join(config.tmpDir, 'scan', randomUUID());
  await fs.mkdir(dir, { recursive: true });
  try {
    const tmp = path.join(dir, 'input.bin');
    await fs.writeFile(tmp, bytes);
    let check: { ok: boolean; detectedKind: string; errors: Array<{ code: string; message: string }>; warnings: Array<{ code: string; message: string }>; stats: Record<string, unknown> };
    try {
      check = (await runPython('check_file.py', [tmp, p.mime, p.originalName], 120_000)) as typeof check;
    } catch (e) {
      if (e instanceof ToolError) throw new JobFailure(e.code, e.message, e.retryable);
      throw e;
    }
    const report: Record<string, unknown> = { check, inspectedAt: new Date().toISOString() };
    if (!check.ok) {
      await tx.query(`UPDATE public.files SET scan_status = 'rejected', scan_report = $2 WHERE id = $1`, [p.fileId, JSON.stringify(report)]);
      return { status: 'rejected', errors: check.errors };
    }
    if (check.detectedKind === 'zip') {
      const insp = await inspectDocxBytes(bytes).catch((e: Error) => { throw new JobFailure('tool_failed', e.message, e instanceof ToolError ? e.retryable : false); });
      report.docxInspection = { ok: insp.ok, errors: insp.issues.filter((i) => i.severity === 'error') };
      if (!insp.ok && file.scope === 'template') {
        await tx.query(`UPDATE public.files SET scan_status = 'rejected', scan_report = $2 WHERE id = $1`, [p.fileId, JSON.stringify(report)]);
        return { status: 'rejected', errors: insp.issues.filter((i) => i.severity === 'error') };
      }
    }
    // ウイルス検査
    const av = await clamdScan(bytes);
    report.antivirus = av;
    if (av.status === 'infected') {
      await tx.query(`UPDATE public.files SET scan_status = 'infected', scan_report = $2 WHERE id = $1`, [p.fileId, JSON.stringify(report)]);
      return { status: 'infected', signature: av.signature };
    }
    if (av.status === 'unavailable') {
      if (!(config.devAllowUnscanned && p.devAllowUnscanned)) {
        await tx.query(`UPDATE public.files SET scan_status = 'scan_failed', scan_report = $2 WHERE id = $1`, [p.fileId, JSON.stringify({ ...report, note: 'scanner 停止のため fail closed。復旧後に再検査' })]);
        throw new JobFailure('scanner_unavailable', 'ClamAV に接続できません（fail closed）', true);
      }
      report.antivirus = { status: 'skipped_dev_unscanned', note: '開発専用: DEV_ALLOW_UNSCANNED=true。本番では使用不可' };
    }
    // PDF 派生安全版
    if (check.detectedKind === 'pdf') {
      const outP = path.join(dir, 'safe.pdf');
      const san = (await runPython('pdf_sanitize.py', [tmp, outP], 120_000).catch(() => null)) as { ok: boolean; removed?: Record<string, number> } | null;
      if (san?.ok) {
        const safe = await fs.readFile(outP);
        const key = randomUUID();
        await blobStore.put(safe, key);
        const rev = await tx.query<{ n: number }>('SELECT COALESCE(max(revision), 0) + 1 AS n FROM public.file_versions WHERE file_id = $1', [p.fileId]);
        await tx.query(`INSERT INTO public.file_versions (org_id, file_id, revision, storage_key, sha256, size, kind, derived_from_id, created_by) VALUES ($1, $2, $3, $4, $5, $6, 'safe_preview', $7, $8)`, [ctx.job.org_id, p.fileId, rev.rows[0]!.n, key, sha256Hex(safe), safe.length, p.fileVersionId, ctx.job.created_by]);
        report.sanitized = san.removed;
      }
    }
    // テキスト添付: encoding を記録（原本 bytes は変更しない）
    if (check.detectedKind === 'text' && typeof check.stats.encoding === 'string') {
      await tx.query('UPDATE public.file_versions SET encoding_name = $2 WHERE id = $1', [p.fileVersionId, check.stats.encoding]);
    }
    await tx.query(`UPDATE public.files SET scan_status = 'clean', scan_report = $2 WHERE id = $1`, [p.fileId, JSON.stringify(report)]);
    return { status: 'clean', detectedKind: check.detectedKind, warnings: check.warnings };
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
