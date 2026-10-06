/**
 * render_draft / render_final / test_template
 * 承認対象 = AST/入力 snapshot/書式 hash/出力 DOCX/PDF hash/添付 manifest/rendererProfile の組。
 */
import { randomUUID } from 'node:crypto';
import { buildRenderData, parseTemplateFieldSchema, type DocumentAST, type FieldValues } from '@raylow/template-schema';
import type { DraftSnapshot } from '@raylow/contracts';
import type { Tx } from '../db.js';
import { blobStore, sha256Hex } from '../blobs.js';
import { config } from '../config.js';
import { RenderError, renderDocx, scanLeftoverTags } from '../render/docx.js';
import { convertToPdf } from '../render/pdf.js';
import { bundledFontManifest } from '../render/fonts.js';
import { runPython, ToolError } from '../python.js';
import { JobFailure, type JobContext } from './types.js';
import fs from 'node:fs/promises';
import path from 'node:path';

type Row = Record<string, unknown>;

interface PdfReport { pages: number; fonts: Array<{ name: string; embedded: boolean }>; unembeddedFonts: string[]; metadata: Record<string, string>; annotations: number; links: number; missingTexts: string[]; hasText: boolean }

async function pdfPreflight(pdf: Buffer, expectTexts: string[]): Promise<PdfReport> {
  const dir = path.join(config.tmpDir, 'preflight', randomUUID());
  await fs.mkdir(dir, { recursive: true });
  try {
    const p = path.join(dir, 'out.pdf');
    await fs.writeFile(p, pdf);
    const args = [p];
    if (expectTexts.length) {
      const t = path.join(dir, 'expect.txt');
      await fs.writeFile(t, expectTexts.join('\n'));
      args.push('--expect-text', t);
    }
    return (await runPython('pdf_fonts.py', args, 120_000)) as PdfReport;
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function storeInternalFile(tx: Tx, orgId: string, matterId: string | null, bytes: Buffer, name: string, mime: string, createdBy: string | null, scope = 'output'): Promise<{ fileId: string; sha256: string }> {
  const key = randomUUID();
  await blobStore.put(bytes, key);
  const sha = sha256Hex(bytes);
  const f = await tx.query<{ id: string }>(`INSERT INTO public.files (org_id, matter_id, scope, storage_key, original_name_raw, mime, size, sha256, scan_status, confidential, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'clean', true, $9) RETURNING id`, [orgId, matterId, scope, key, name, mime, bytes.length, sha, createdBy]);
  await tx.query(`INSERT INTO public.file_versions (org_id, file_id, revision, storage_key, sha256, size, kind, created_by) VALUES ($1, $2, 1, $3, $4, $5, $6, $7)`, [orgId, f.rows[0]!.id, key, sha, bytes.length, mime === 'application/pdf' ? 'derived_pdf' : 'original', createdBy]);
  return { fileId: f.rows[0]!.id, sha256: sha };
}

function statusLabel(mode: 'draft' | 'final' | 'test', sampleOnly: boolean): string {
  if (mode === 'final') return '';
  if (mode === 'test') return '【試作・架空データ】サンプル・要確認';
  return sampleOnly ? '【草案・未承認】サンプル・要確認' : '【草案・未承認】';
}

export async function renderDraftJob(ctx: JobContext, tx: Tx): Promise<Record<string, unknown>> {
  const p = ctx.job.payload as { draftId: string; revisionId: string; mode: 'draft' | 'final'; hash: string; batchItemId?: string };
  const rev = await tx.query<Row>('SELECT r.*, d.org_id AS d_org, d.matter_id, d.status AS draft_status, d.approved_revision_id, d.title_raw FROM public.draft_revisions r JOIN public.drafts d ON d.id = r.draft_id WHERE r.id = $1 AND r.draft_id = $2', [p.revisionId, p.draftId]);
  const r = rev.rows[0];
  if (!r) throw new JobFailure('not_found', 'revision が見つかりません', false);
  // worker は job の org/matter を再確認する
  if (r.d_org !== ctx.job.org_id || (ctx.job.matter_id && r.matter_id !== ctx.job.matter_id)) throw new JobFailure('scope_mismatch', 'job の org/matter と対象が一致しません', false);
  if (r.hash !== p.hash) throw new JobFailure('hash_mismatch', 'revision hash が job と一致しません', false);
  if (p.mode === 'final' && (r.draft_status !== 'approved' || r.approved_revision_id !== p.revisionId)) throw new JobFailure('not_approved', '正式版は承認済み revision のみ', false);
  const tv = await tx.query<Row>('SELECT tv.*, f.storage_key, rp.settings AS rp_settings FROM public.template_versions tv JOIN public.files f ON f.id = tv.docx_file_id LEFT JOIN public.renderer_profiles rp ON rp.id = tv.renderer_profile_id WHERE tv.id = $1', [r.template_version_id]);
  const t = tv.rows[0];
  if (!t) throw new JobFailure('not_found', '書式版が見つかりません', false);
  if (p.mode === 'final' && t.sample_only) throw new JobFailure('template_sample_only', 'サンプル書式では正式出力できません', false);
  const parsed = parseTemplateFieldSchema(t.field_schema);
  if (!parsed.schema) throw new JobFailure('schema_invalid', '書式スキーマが不正です', false);
  const templateBytes = await blobStore.get(t.storage_key as string);
  if (sha256Hex(templateBytes) !== t.docx_sha256) throw new JobFailure('template_hash_mismatch', '書式 DOCX の hash が登録時と異なります', false);
  const snapshot = r.snapshot_json as DraftSnapshot;
  const ast = r.ast_json as DocumentAST;
  if (!(await ctx.progress({ step: 'render_docx', label: 'DOCX を生成中' }))) throw new JobFailure('cancelled', 'キャンセルされました', false);
  const data = buildRenderData(parsed.schema, snapshot.fields as FieldValues, ast, { documentStatusLabel: statusLabel(p.mode, t.sample_only as boolean), templateVersionLabel: `書式版 r${t.revision as number}${t.sample_only ? '（サンプル）' : ''}`, issueDateIso: snapshot.issueDate, attachments: snapshot.attachments.map((a) => ({ name: a.name, copies: a.copies })) });
  // recipient snapshot からの供給（schema に無い場合も共通キーとして渡す）
  const rs = snapshot.recipient;
  const fill = (k: string, v: string) => { if (!(k in data)) data[k] = v; };
  fill('recipient_name', rs.nameRaw); fill('recipient_honorific', rs.honorific); fill('recipient_organization', rs.organizationNameRaw); fill('recipient_address', rs.addressRaw); fill('recipient_postcode', rs.postcodeRaw);
  const m = await tx.query<Row>('SELECT title_raw, case_number_raw, court_raw, court_department_raw FROM public.matters WHERE id = $1', [r.matter_id]);
  fill('matter_title', (m.rows[0]?.title_raw as string) ?? ''); fill('matter_id', r.matter_id as string); fill('subject', (r.title_raw as string) ?? '');
  let rendered;
  try {
    rendered = renderDocx(templateBytes, data, { statusLabel: statusLabel(p.mode, t.sample_only as boolean), stripMetadata: p.mode === 'final' });
  } catch (e) {
    if (e instanceof RenderError) throw new JobFailure(e.code, e.message, false, e.details);
    throw e;
  }
  const leftover = scanLeftoverTags(rendered.bytes);
  if (leftover.length) throw new JobFailure('unreplaced_tag', `未置換タグが残っています: ${leftover.join(', ')}`, false, { unreplacedTags: leftover });
  if (!(await ctx.progress({ step: 'convert_pdf', label: 'PDF へ変換中' }))) throw new JobFailure('cancelled', 'キャンセルされました', false);
  let pdf: Buffer;
  let converterVersion: string;
  try {
    const c = await convertToPdf(rendered.bytes);
    pdf = c.pdf;
    converterVersion = c.converterVersion;
  } catch (e) {
    if (e instanceof ToolError) throw new JobFailure(e.code, e.message, e.retryable);
    throw e;
  }
  if (!(await ctx.progress({ step: 'preflight', label: 'PDF を検査中' }))) throw new JobFailure('cancelled', 'キャンセルされました', false);
  const expect = [rs.nameRaw, (m.rows[0]?.case_number_raw as string) ?? ''].filter((x) => x && x.length >= 2).slice(0, 2);
  const pre = await pdfPreflight(pdf, expect).catch((e: Error) => { throw new JobFailure('preflight_failed', e.message, e instanceof ToolError ? e.retryable : false); });
  // 字体不足: PDF 内に Noto 以外へ fallback した跡（埋込されていない or 既知フォント以外）を検出
  const fontNames = pre.fonts.map((f) => f.name);
  const bundled = bundledFontManifest();
  const bundledFamilies = ['NotoSansJP', 'NotoSerifJP', 'BricolageGrotesque', 'Noto Sans JP', 'Noto Serif JP'];
  const unexpectedFonts = fontNames.filter((n) => !bundledFamilies.some((b) => n.replace(/[-\s]/g, '').includes(b.replace(/[-\s]/g, ''))));
  const report = {
    unreplacedTags: [],
    missingFonts: unexpectedFonts.length ? unexpectedFonts.map((f) => `${f}（同梱フォント以外へのフォールバック。字体不足の可能性）`) : [],
    unembeddedFonts: pre.unembeddedFonts,
    pages: pre.pages,
    metadataFound: Object.entries(pre.metadata).filter(([k, v]) => v && !['/Producer', '/Creator', '/CreationDate', '/ModDate'].includes(k)).map(([k, v]) => `${k}=${v}`),
    missingTexts: pre.missingTexts,
    insertedStatusParagraph: rendered.insertedStatusParagraph,
    converterVersion,
    rendererVersion: config.rendererVersion,
    fonts: pre.fonts,
    annotations: pre.annotations,
    links: pre.links,
    overflowCandidates: Object.entries(snapshot.fields).filter(([, v]) => typeof v.rawValue === 'string' && (v.rawValue as string).length > 40 && !(v.rawValue as string).includes('\n')).map(([k]) => k).slice(0, 5),
  };
  if (pre.missingTexts.length) report.unreplacedTags = [] as never;
  const fontManifest = { bundled, pdfFonts: pre.fonts, converterVersion };
  const outName = `${(r.title_raw as string) || 'document'}`;
  const createdBy = ctx.job.created_by;
  const docxFile = await storeInternalFile(tx, ctx.job.org_id, r.matter_id as string, rendered.bytes, `${outName}.docx`, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', createdBy);
  const pdfFile = await storeInternalFile(tx, ctx.job.org_id, r.matter_id as string, pdf, `${outName}.pdf`, 'application/pdf', createdBy);
  await tx.query(`UPDATE public.draft_outputs SET status = 'superseded' WHERE revision_id = $1 AND mode = $2 AND status = 'ready'`, [p.revisionId, p.mode]);
  const o1 = await tx.query<{ id: string }>(`INSERT INTO public.draft_outputs (org_id, revision_id, format, mode, file_id, sha256, renderer_version, font_manifest, preflight_report, status, created_by) VALUES ($1, $2, 'docx', $3, $4, $5, $6, $7, $8, 'ready', $9) RETURNING id`, [ctx.job.org_id, p.revisionId, p.mode, docxFile.fileId, docxFile.sha256, config.rendererVersion, JSON.stringify(fontManifest), JSON.stringify(report), createdBy]);
  const o2 = await tx.query<{ id: string }>(`INSERT INTO public.draft_outputs (org_id, revision_id, format, mode, file_id, sha256, renderer_version, font_manifest, preflight_report, status, created_by) VALUES ($1, $2, 'pdf', $3, $4, $5, $6, $7, $8, 'ready', $9) RETURNING id`, [ctx.job.org_id, p.revisionId, p.mode, pdfFile.fileId, pdfFile.sha256, `${config.rendererVersion};${converterVersion}`, JSON.stringify(fontManifest), JSON.stringify(report), createdBy]);
  if (p.mode === 'draft') await tx.query(`UPDATE public.drafts SET status = 'ready_for_review' WHERE id = $1 AND status = 'rendering' AND current_revision_id = $2`, [p.draftId, p.revisionId]);
  if (p.batchItemId) await tx.query(`UPDATE public.batch_items SET status = 'succeeded', updated_at = now() WHERE id = $1`, [p.batchItemId]);
  await tx.query(`INSERT INTO public.audit_events (org_id, matter_id, actor_id, actor_role, action, target_type, target_id, target_hash, request_id, details) VALUES ($1, $2, $3, 'worker', $4, 'draft_revision', $5, $6, $7, $8)`, [ctx.job.org_id, r.matter_id, createdBy, p.mode === 'final' ? 'output.final_rendered' : 'output.draft_rendered', p.revisionId, pdfFile.sha256, ctx.job.id, JSON.stringify({ docxSha256: docxFile.sha256, pdfSha256: pdfFile.sha256, pages: pre.pages, converterVersion })]);
  return { docxOutputId: o1.rows[0]!.id, pdfOutputId: o2.rows[0]!.id, docxSha256: docxFile.sha256, pdfSha256: pdfFile.sha256, pages: pre.pages, preflight: report };
}

/** 書式版の架空データ試作（test_template） */
export async function testTemplateJob(ctx: JobContext, tx: Tx): Promise<Record<string, unknown>> {
  const p = ctx.job.payload as { templateVersionId: string; sampleValues: Record<string, unknown> | null };
  const tv = await tx.query<Row>('SELECT tv.*, f.storage_key FROM public.template_versions tv JOIN public.files f ON f.id = tv.docx_file_id WHERE tv.id = $1', [p.templateVersionId]);
  const t = tv.rows[0];
  if (!t) throw new JobFailure('not_found', '書式版が見つかりません', false);
  if (t.org_id !== ctx.job.org_id) throw new JobFailure('scope_mismatch', 'org 不一致', false);
  const parsed = parseTemplateFieldSchema(t.field_schema);
  if (!parsed.schema) throw new JobFailure('schema_invalid', `スキーマ不正: ${parsed.issues.map((i) => i.message).join('; ')}`, false);
  const schema = parsed.schema;
  const values: FieldValues = {};
  const sample = p.sampleValues ?? {};
  for (const f of schema.fields) {
    let v: unknown = sample[f.key];
    if (v === undefined) {
      if (f.type === 'array') v = [Object.fromEntries((f.itemFields ?? []).map((it) => [it.key, it.type === 'boolean' ? true : `（${it.label}の例）`]))];
      else if (f.type === 'boolean') v = true;
      else if (f.type === 'enum') v = f.options?.[0]?.value ?? '';
      else if (f.type === 'date') v = '2026-10-06';
      else if (f.type === 'money') v = '１，２３４，５６７';
      else v = `（${f.label}の架空例）`;
    }
    values[f.key] = { rawValue: v, sourceId: null, sourceVersion: null, manuallyOverridden: true };
  }
  const ast: DocumentAST = { schemaVersion: 1, blocks: [{ id: 't1', type: 'heading', level: 1, text: '第１　試作見出し（架空）' }, { id: 't2', type: 'numberedParagraph', numberLabel: '１', text: 'これは架空データによる試作出力です。全角数字１２３、長い氏名「佐藤佐藤佐藤佐藤佐藤佐藤佐藤佐藤佐藤佐藤佐藤佐藤佐藤佐藤佐藤」、異体字「髙﨑」。', level: 1 }, { id: 't3', type: 'paragraph', text: '改行を含む段落\n２行目です。' }] };
  const data = buildRenderData(schema, values, ast, { documentStatusLabel: '【試作・架空データ】サンプル・要確認', templateVersionLabel: `書式版 r${t.revision as number}（試作）`, issueDateIso: '2026-10-06', attachments: [{ name: '添付資料の例', copies: '１通' }] });
  const fill = (k: string, v: string) => { if (!(k in data)) data[k] = v; };
  for (const [k, v] of Object.entries({ recipient_name: '佐藤 一郎', recipient_honorific: '先生', recipient_organization: '第一法律事務所', recipient_address: '東京都中央区日本橋一丁目２番３号', recipient_postcode: '１０３－００２７', office_name: '青葉法律事務所', office_address: '東京都千代田区霞が関一丁目１番１号', office_postcode: '１００－００１３', office_phone: '０３－１２３４－５６７８', office_fax: '０３－１２３４－５６７９', office_email: 'info@aoba.example', lawyer_name: '青葉 花子', lawyer_title: '弁護士', matter_title: '売買代金請求事件（試作）', matter_id: '00000000-0000-0000-0000-000000000000', client_name: '株式会社ミドリ商事', opponent_name: '髙橋　太郎', subject: '試作' })) fill(k, v);
  const templateBytes = await blobStore.get(t.storage_key as string);
  let rendered;
  try {
    rendered = renderDocx(templateBytes, data, { statusLabel: '【試作・架空データ】サンプル・要確認', stripMetadata: false });
  } catch (e) {
    if (e instanceof RenderError) throw new JobFailure(e.code, e.message, false, e.details);
    throw e;
  }
  if (!(await ctx.progress({ step: 'convert_pdf', label: 'PDF へ変換中' }))) throw new JobFailure('cancelled', 'キャンセル', false);
  let c;
  try { c = await convertToPdf(rendered.bytes); } catch (e) { if (e instanceof ToolError) throw new JobFailure(e.code, e.message, e.retryable); throw e; }
  const pre = await pdfPreflight(c.pdf, ['佐藤 一郎']).catch((e: Error) => { throw new JobFailure('preflight_failed', e.message, false); });
  const docx = await storeInternalFile(tx, ctx.job.org_id, null, rendered.bytes, `test_${t.revision as number}.docx`, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', ctx.job.created_by, 'template');
  const pdf = await storeInternalFile(tx, ctx.job.org_id, null, c.pdf, `test_${t.revision as number}.pdf`, 'application/pdf', ctx.job.created_by, 'template');
  return { outputFileId: pdf.fileId, docxFileId: docx.fileId, pdfSha256: pdf.sha256, pages: pre.pages, fonts: pre.fonts, unembeddedFonts: pre.unembeddedFonts, tagsInTemplate: rendered.tagsInTemplate, converterVersion: c.converterVersion };
}
