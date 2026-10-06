/** inspect_template: Python 構造検査 + スキーマ照合。結果を template_versions.inspection_report へ。 */
import { parseTemplateFieldSchema, validateTemplateSchema, type DiscoveredTag } from '@raylow/template-schema';
import type { Tx } from '../db.js';
import { blobStore } from '../blobs.js';
import { config } from '../config.js';
import { runPython, ToolError } from '../python.js';
import { JobFailure, type JobContext } from './types.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

type Row = Record<string, unknown>;
interface PyReport { ok: boolean; inspectorVersion: string; issues: Array<{ severity: string; code: string; message: string; location?: string; hint?: string }>; tags: DiscoveredTag[]; stats: Record<string, unknown>; residualTextCandidates: Array<{ location: string; text: string; reason: string }> }

export async function inspectDocxBytes(bytes: Buffer): Promise<PyReport> {
  const dir = path.join(config.tmpDir, 'inspect', randomUUID());
  await fs.mkdir(dir, { recursive: true });
  try {
    const p = path.join(dir, 'template.docx');
    await fs.writeFile(p, bytes);
    return (await runPython('inspect_docx.py', [p], 120_000)) as PyReport;
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function inspectTemplateJob(ctx: JobContext, tx: Tx): Promise<Record<string, unknown>> {
  const p = ctx.job.payload as { templateVersionId: string; fileId: string };
  const tv = await tx.query<Row>('SELECT tv.*, f.storage_key, f.id AS file_id FROM public.template_versions tv JOIN public.files f ON f.id = tv.docx_file_id WHERE tv.id = $1 FOR UPDATE OF tv', [p.templateVersionId]);
  const t = tv.rows[0];
  if (!t) throw new JobFailure('not_found', '書式版が見つかりません', false);
  if (t.org_id !== ctx.job.org_id) throw new JobFailure('scope_mismatch', 'org 不一致', false);
  const bytes = await blobStore.get(t.storage_key as string);
  let rep: PyReport;
  try {
    rep = await inspectDocxBytes(bytes);
  } catch (e) {
    if (e instanceof ToolError) throw new JobFailure(e.code, e.message, e.retryable);
    throw e;
  }
  // スキーマ照合（初期スキーマは最小なので undefined_tag が出る。UI で対応付けする）
  const parsed = parseTemplateFieldSchema(t.field_schema);
  const schemaIssues = parsed.schema ? validateTemplateSchema(parsed.schema, rep.tags) : parsed.issues;
  const issues = [...rep.issues, ...schemaIssues.filter((i) => i.code !== 'undefined_tag' && i.code !== 'unused_field' && i.code !== 'body_tag_missing').map((i) => ({ severity: i.severity, code: i.code, message: i.message, location: i.location ?? '', hint: '', fieldKey: i.fieldKey, tag: i.tag }))];
  const unmapped = rep.tags.filter((tg) => tg.valid).map((tg) => tg.key).filter((k, i, a) => a.indexOf(k) === i);
  const report = { ok: rep.ok && !issues.some((i) => i.severity === 'error'), issues, tags: rep.tags, stats: { ...rep.stats, unmappedKeys: unmapped }, residualTextCandidates: rep.residualTextCandidates, inspectorVersion: rep.inspectorVersion };
  await tx.query(`UPDATE public.template_versions SET inspection_report = $2 WHERE id = $1`, [p.templateVersionId, JSON.stringify(report)]);
  await tx.query(`UPDATE public.files SET scan_status = CASE WHEN $2 THEN 'clean' ELSE 'rejected' END, scan_report = $3 WHERE id = $1 AND scan_status IN ('quarantine','scanning')`, [t.file_id, rep.ok, JSON.stringify({ inspector: rep.inspectorVersion, ok: rep.ok, errors: rep.issues.filter((i) => i.severity === 'error').length })]);
  if (!rep.ok) {
    // 構造的に拒否された書式は失敗として修正導線へ（自動再試行しない）
    throw new JobFailure('template_rejected', `対応外要素があります: ${rep.issues.filter((i) => i.severity === 'error').map((i) => `${i.code}@${i.location ?? ''}`).join(', ')}`, false, { report });
  }
  return { ok: report.ok, tagCount: rep.tags.length, unmappedKeys: unmapped, errors: issues.filter((i) => i.severity === 'error').length };
}
