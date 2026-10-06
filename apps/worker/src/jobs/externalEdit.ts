/** external_edit_ingest: Word で編集した DOCX の再取込 → scan → 新 PDF → 草案出力（外部編集版）。AST へは戻さない。 */
import { randomUUID } from 'node:crypto';
import type { Tx } from '../db.js';
import { blobStore, sha256Hex } from '../blobs.js';
import { config } from '../config.js';
import { convertToPdf } from '../render/pdf.js';
import { ToolError } from '../python.js';
import { inspectDocxBytes } from './inspect.js';
import { JobFailure, type JobContext } from './types.js';

type Row = Record<string, unknown>;

export async function externalEditJob(ctx: JobContext, tx: Tx): Promise<Record<string, unknown>> {
  const p = ctx.job.payload as { draftId: string; revisionId: string; fileId: string; fileVersionId: string };
  const r = await tx.query<Row>('SELECT r.*, d.org_id AS d_org, d.matter_id, d.title_raw FROM public.draft_revisions r JOIN public.drafts d ON d.id = r.draft_id WHERE r.id = $1 AND r.kind = $2', [p.revisionId, 'external_edit']);
  const rev = r.rows[0];
  if (!rev) throw new JobFailure('not_found', '外部編集版が見つかりません', false);
  if (rev.d_org !== ctx.job.org_id) throw new JobFailure('scope_mismatch', 'org 不一致', false);
  const fv = await tx.query<Row>('SELECT fv.*, f.scan_status FROM public.file_versions fv JOIN public.files f ON f.id = fv.file_id WHERE fv.id = $1', [p.fileVersionId]);
  const v = fv.rows[0];
  if (!v) throw new JobFailure('not_found', 'ファイルが見つかりません', false);
  if (v.scan_status !== 'clean') throw new JobFailure('file_not_clean', `アップロードファイルの検査が完了していません（${v.scan_status as string}）`, true);
  const bytes = await blobStore.get(v.storage_key as string);
  if (sha256Hex(bytes) !== v.sha256) throw new JobFailure('hash_mismatch', 'hash 不一致', false);
  // 外部編集版は書式ではないが、マクロ/OLE/外部参照は同じ基準で拒否する（コメント・変更履歴は警告として残す）
  const insp = await inspectDocxBytes(bytes).catch((e: Error) => { throw new JobFailure('tool_failed', e.message, e instanceof ToolError ? e.retryable : false); });
  const hard = insp.issues.filter((i) => i.severity === 'error' && ['macro_enabled', 'ole_object', 'external_relationship', 'alt_chunk', 'path_traversal', 'compression_ratio', 'not_docx', 'bad_zip'].includes(i.code));
  if (hard.length) throw new JobFailure('external_edit_rejected', `外部編集版に対応外要素: ${hard.map((i) => i.code).join(', ')}`, false, { issues: hard });
  if (!(await ctx.progress({ step: 'convert_pdf', label: 'PDF へ変換中' }))) throw new JobFailure('cancelled', 'キャンセル', false);
  let c;
  try { c = await convertToPdf(bytes); } catch (e) { if (e instanceof ToolError) throw new JobFailure(e.code, e.message, e.retryable); throw e; }
  const key = randomUUID();
  await blobStore.put(c.pdf, key);
  const pdfSha = sha256Hex(c.pdf);
  const f = await tx.query<{ id: string }>(`INSERT INTO public.files (org_id, matter_id, scope, storage_key, original_name_raw, mime, size, sha256, scan_status, confidential, created_by) VALUES ($1, $2, 'output', $3, $4, 'application/pdf', $5, $6, 'clean', true, $7) RETURNING id`, [ctx.job.org_id, rev.matter_id, key, `${rev.title_raw as string}（外部編集版）.pdf`, c.pdf.length, pdfSha, ctx.job.created_by]);
  await tx.query(`INSERT INTO public.file_versions (org_id, file_id, revision, storage_key, sha256, size, kind, derived_from_id, created_by) VALUES ($1, $2, 1, $3, $4, $5, 'derived_pdf', $6, $7)`, [ctx.job.org_id, f.rows[0]!.id, key, pdfSha, c.pdf.length, p.fileVersionId, ctx.job.created_by]);
  const report = { externalEdit: true, inspectionWarnings: insp.issues.filter((i) => i.severity !== 'info').map((i) => `${i.code}: ${i.message}`), metadataFound: insp.issues.filter((i) => i.code === 'metadata_present').map((i) => i.message), converterVersion: c.converterVersion, note: '外部編集版。アプリ AST とは同期しない。承認は再度必要' };
  await tx.query(`UPDATE public.draft_outputs SET status = 'superseded' WHERE revision_id = $1 AND mode = 'draft' AND status = 'ready'`, [p.revisionId]);
  await tx.query(`INSERT INTO public.draft_outputs (org_id, revision_id, format, mode, file_id, sha256, renderer_version, font_manifest, preflight_report, status, created_by) VALUES ($1, $2, 'docx', 'draft', $3, $4, $5, '[]', $6, 'ready', $7)`, [ctx.job.org_id, p.revisionId, v.file_id, v.sha256, 'external-edit', JSON.stringify(report), ctx.job.created_by]);
  await tx.query(`INSERT INTO public.draft_outputs (org_id, revision_id, format, mode, file_id, sha256, renderer_version, font_manifest, preflight_report, status, created_by) VALUES ($1, $2, 'pdf', 'draft', $3, $4, $5, '[]', $6, 'ready', $7)`, [ctx.job.org_id, p.revisionId, f.rows[0]!.id, pdfSha, `external-edit;${c.converterVersion}`, JSON.stringify(report), ctx.job.created_by]);
  await tx.query(`UPDATE public.drafts SET status = 'ready_for_review' WHERE id = $1 AND current_revision_id = $2 AND status IN ('draft','rendering')`, [p.draftId, p.revisionId]);
  void config;
  return { pdfSha256: pdfSha, warnings: report.inspectionWarnings.length };
}
