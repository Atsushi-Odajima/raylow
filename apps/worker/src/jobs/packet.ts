/**
 * render_packet: 選択した書面 PDF/DOCX と証拠の派生提出用 PDF、manifest.json、確認一覧.txt を安全な連番名で ZIP 化。
 * 内部監査・原本・所内メモは初期選択しない（API 側で選択制）。
 */
import yazl from 'yazl';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { canonicalJson } from '@raylow/domain';
import { graphemeLength, truncateGraphemes } from '@raylow/japanese-text';
import type { Tx } from '../db.js';
import { blobStore, sha256Hex } from '../blobs.js';
import { config } from '../config.js';
import { runPython } from '../python.js';
import { JobFailure, type JobContext } from './types.js';

type Row = Record<string, unknown>;

function safeEntryName(seq: number, display: string, ext: string, maxGraphemes: number): string {
  // eslint-disable-next-line no-control-regex
  const cleaned = display.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '＿').replace(/\.+$/, '').trim() || 'document';
  const short = graphemeLength(cleaned) > maxGraphemes ? truncateGraphemes(cleaned, maxGraphemes) : cleaned;
  return `${String(seq).padStart(3, '0')}_${short}.${ext}`;
}

function zipBuffer(entries: Array<{ name: string; bytes: Buffer }>): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const zip = new yazl.ZipFile();
    for (const e of entries) zip.addBuffer(e.bytes, e.name, { mtime: new Date('2000-01-01T00:00:00Z'), mode: 0o644 });
    const chunks: Buffer[] = [];
    zip.outputStream.on('data', (c: Buffer) => chunks.push(c));
    zip.outputStream.on('end', () => resolve(Buffer.concat(chunks)));
    zip.outputStream.on('error', reject);
    zip.end();
  });
}

export async function renderPacketJob(ctx: JobContext, tx: Tx): Promise<Record<string, unknown>> {
  const p = ctx.job.payload as { packetId: string; itemIds: string[]; version: number };
  const pk = await tx.query<Row>('SELECT p.*, cp.name AS cp_name, cp.version AS cp_version, cp.naming_rules, cp.file_rules FROM public.packets p LEFT JOIN public.court_profiles cp ON cp.id = p.court_profile_id WHERE p.id = $1 FOR UPDATE OF p', [p.packetId]);
  const packet = pk.rows[0];
  if (!packet) throw new JobFailure('not_found', 'パックが見つかりません', false);
  if (packet.org_id !== ctx.job.org_id || packet.matter_id !== ctx.job.matter_id) throw new JobFailure('scope_mismatch', 'org/matter 不一致', false);
  if ((packet.version as number) !== p.version) throw new JobFailure('stale', 'パックが job 作成後に変更されました。再度検査・出力してください', false);
  const items = await tx.query<Row>(
    `SELECT pi.*, o.format AS o_format, o.mode AS o_mode, o.sha256 AS o_sha, fo.storage_key AS o_key, d.title_raw AS d_title, d.status AS d_status, d.approved_revision_id, o.revision_id,
            fv.storage_key AS fv_key, fv.sha256 AS fv_sha, fv.kind AS fv_kind, f.original_name_raw AS f_name, f.mime AS f_mime, f.scan_status, f.confidential, f.id AS f_id, e.display_label
     FROM public.packet_items pi
     LEFT JOIN public.draft_outputs o ON o.id = pi.output_id LEFT JOIN public.files fo ON fo.id = o.file_id LEFT JOIN public.draft_revisions r ON r.id = o.revision_id LEFT JOIN public.drafts d ON d.id = r.draft_id
     LEFT JOIN public.file_versions fv ON fv.id = pi.file_version_id LEFT JOIN public.files f ON f.id = fv.file_id
     LEFT JOIN public.evidence e ON e.id = pi.evidence_id
     WHERE pi.packet_id = $1 ORDER BY pi.order_no`,
    [p.packetId],
  );
  const naming = (packet.naming_rules as { maxNameGraphemes?: number } | null) ?? {};
  const maxName = naming.maxNameGraphemes ?? 60;
  const entries: Array<{ name: string; bytes: Buffer }> = [];
  const manifestItems: Array<Record<string, unknown>> = [];
  const checklist: string[] = [`提出パック 確認一覧`, `案件ID: ${packet.matter_id as string}`, `パック: ${(packet.title_raw as string) || '(無題)'} r${packet.revision as number}`, `適用 profile: ${(packet.cp_name as string) ?? '未設定'} v${(packet.cp_version as number) ?? '-'}（形式上の確認のみ。法的審査ではない）`, `生成日時(UTC): ${new Date().toISOString()}`, ''];
  let seq = 0;
  const work = path.join(config.tmpDir, 'packet', randomUUID());
  await fs.mkdir(work, { recursive: true });
  try {
    for (const it of items.rows) {
      if (!(await ctx.progress({ step: 'collect', label: `${seq + 1}/${items.rows.length} 書類を収集中` }))) throw new JobFailure('cancelled', 'キャンセル', false);
      seq += 1;
      if (it.output_id) {
        if (it.o_mode !== 'final' || it.d_status !== 'approved' || it.approved_revision_id !== it.revision_id) throw new JobFailure('item_not_approved', `${it.d_title as string} は承認済み正式版ではありません`, false);
        const bytes = await blobStore.get(it.o_key as string);
        if (sha256Hex(bytes) !== it.o_sha) throw new JobFailure('hash_mismatch', `${it.d_title as string} の出力 hash が一致しません`, false);
        const name = safeEntryName(seq, (it.display_name_raw as string) || (it.d_title as string), it.o_format as string, maxName);
        entries.push({ name, bytes });
        manifestItems.push({ seq, entry: name, kind: `document_${it.o_format as string}`, displayName: it.display_name_raw || it.d_title, outputId: it.output_id, revisionId: it.revision_id, sha256: it.o_sha, approved: true });
        checklist.push(`[ ] ${name}  ← 書面「${it.d_title as string}」正式版 ${it.o_format as string}  sha256=${(it.o_sha as string).slice(0, 16)}…`);
      } else if (it.fv_key) {
        if (it.scan_status !== 'clean') throw new JobFailure('file_not_clean', `${it.f_name as string} は検査未完了/拒否です`, false);
        if (it.confidential && !it.external_output_confirmed) throw new JobFailure('confidential_not_confirmed', `${it.f_name as string} の外部出力可否が未確認です`, false);
        let bytes = await blobStore.get(it.fv_key as string);
        if (sha256Hex(bytes) !== it.fv_sha) throw new JobFailure('hash_mismatch', `${it.f_name as string} の hash が一致しません`, false);
        let ext = 'bin';
        let kind = 'file';
        if ((it.f_mime as string) === 'application/pdf' || String(it.fv_kind).includes('pdf')) {
          // 派生提出用 PDF: メタデータ・外部参照・注釈アクションを除いた派生物
          const inP = path.join(work, `${seq}.pdf`);
          const outP = path.join(work, `${seq}.sub.pdf`);
          await fs.writeFile(inP, bytes);
          const san = (await runPython('pdf_sanitize.py', [inP, outP], 120_000).catch(() => null)) as { ok: boolean } | null;
          if (!san?.ok) throw new JobFailure('sanitize_failed', `${it.f_name as string} の提出用 PDF を生成できません`, false);
          bytes = await fs.readFile(outP);
          ext = 'pdf';
          kind = it.evidence_id ? 'evidence_pdf' : 'attachment_pdf';
        } else if ((it.f_mime as string) === 'image/png') ext = 'png';
        else if ((it.f_mime as string) === 'image/jpeg') ext = 'jpg';
        else if ((it.f_mime as string).includes('wordprocessingml')) ext = 'docx';
        else if ((it.f_mime as string).startsWith('text/')) ext = 'txt';
        const display = (it.display_name_raw as string) || (it.display_label ? `${it.display_label as string}` : (it.f_name as string).replace(/\.[^.]+$/, ''));
        const name = safeEntryName(seq, display, ext, maxName);
        entries.push({ name, bytes });
        manifestItems.push({ seq, entry: name, kind, displayName: display, originalName: it.f_name, fileVersionId: it.file_version_id, evidenceId: it.evidence_id, sourceSha256: it.fv_sha, derivedSha256: sha256Hex(bytes), confidential: it.confidential, externalOutputConfirmed: it.external_output_confirmed });
        checklist.push(`[ ] ${name}  ← ${it.evidence_id ? '証拠 ' + (it.display_label as string) : '資料'} 原本「${it.f_name as string}」${kind.includes('pdf') ? '（派生提出用 PDF）' : ''}`);
      }
    }
    const manifest = { schemaVersion: 2, packetId: p.packetId, matterId: packet.matter_id, revision: packet.revision, courtProfile: { id: packet.court_profile_id, name: packet.cp_name, version: packet.cp_version, note: '形式上の確認のみ。公式仕様は提出先ごとに確認する' }, generatedAt: new Date().toISOString(), items: manifestItems, note: 'ZIP 取得は提出済みを意味しない。提出後に送付/提出記録を登録する' };
    const manifestBytes = Buffer.from(canonicalJson(manifest), 'utf8');
    entries.push({ name: 'manifest.json', bytes: manifestBytes });
    checklist.push('', '※ ZIP の取得は提出済みを意味しません。提出後に送付/提出記録を登録し、他担当者が確認します。');
    entries.push({ name: '確認一覧.txt', bytes: Buffer.from(checklist.join('\n') + '\n', 'utf8') });
    const zipBytes = await zipBuffer(entries);
    const key = randomUUID();
    await blobStore.put(zipBytes, key);
    const sha = sha256Hex(zipBytes);
    const f = await tx.query<{ id: string }>(`INSERT INTO public.files (org_id, matter_id, scope, storage_key, original_name_raw, mime, size, sha256, scan_status, confidential, created_by) VALUES ($1, $2, 'packet', $3, $4, 'application/zip', $5, $6, 'clean', true, $7) RETURNING id`, [ctx.job.org_id, packet.matter_id, key, `packet_${(packet.title_raw as string) || p.packetId}.zip`, zipBytes.length, sha, ctx.job.created_by]);
    await tx.query(`INSERT INTO public.file_versions (org_id, file_id, revision, storage_key, sha256, size, kind, created_by) VALUES ($1, $2, 1, $3, $4, $5, 'original', $6)`, [ctx.job.org_id, f.rows[0]!.id, key, sha, zipBytes.length, ctx.job.created_by]);
    await tx.query(`UPDATE public.packets SET status = 'rendered', manifest_json = $2, hash = $3, file_id = $4 WHERE id = $1`, [p.packetId, JSON.stringify(manifest), sha, f.rows[0]!.id]);
    await tx.query(`INSERT INTO public.audit_events (org_id, matter_id, actor_id, actor_role, action, target_type, target_id, target_hash, request_id, details) VALUES ($1, $2, $3, 'worker', 'packet.rendered', 'packet', $4, $5, $6, $7)`, [ctx.job.org_id, packet.matter_id, ctx.job.created_by, p.packetId, sha, ctx.job.id, JSON.stringify({ items: manifestItems.length })]);
    return { packetId: p.packetId, fileId: f.rows[0]!.id, sha256: sha, items: manifestItems.length };
  } finally {
    await fs.rm(work, { recursive: true, force: true }).catch(() => undefined);
  }
}
