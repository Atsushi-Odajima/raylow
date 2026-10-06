/**
 * export: DOCX/PDF は outputs から取得するため、ここでは CSV/JSON/ZIP を生成する。
 * schemaVersion=2、原文と関係 ID と hash を含む。CSV 式注入対策。原文完全保存は JSON/TXT。
 * full_backup は admin 向け全量（DB JSON + 原本 ZIP）。復元は空環境限定（scripts/restore.mjs）。
 */
import yazl from 'yazl';
import iconv from 'iconv-lite';
import { stringify } from 'csv-stringify/sync';
import { randomUUID } from 'node:crypto';
import { canonicalJson } from '@raylow/domain';
import type { Tx } from '../db.js';
import { blobStore, sha256Hex } from '../blobs.js';
import { JobFailure, type JobContext } from './types.js';

type Row = Record<string, unknown>;

function csvSafe(v: unknown): string {
  const s = v == null ? '' : String(v);
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}

function encodeCsv(rows: Array<Record<string, unknown>>, columns: string[], encoding: 'utf8_bom' | 'cp932'): Buffer {
  const text = stringify(rows.map((r) => Object.fromEntries(columns.map((c) => [c, csvSafe(r[c])]))), { header: true, columns, quoted: true, record_delimiter: '\r\n' });
  if (encoding === 'cp932') {
    // 全セル strict encode 可の場合だけ許可
    const enc = iconv.encode(text, 'Shift_JIS');
    const back = iconv.decode(enc, 'Shift_JIS');
    if (back !== text) throw new JobFailure('cp932_unencodable', 'CP932 で表現できない文字が含まれるため CP932 出力できません。UTF-8 を選んでください', false);
    return enc;
  }
  return Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text, 'utf8')]);
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

async function accessibleMatters(tx: Tx, orgId: string, userId: string, role: string, matterId: string | null): Promise<string[]> {
  // worker は service role なので、要求者の ACL をここで再現する（barrier 優先、member 必須）
  const r = await tx.query<{ id: string }>(
    `SELECT m.id FROM public.matters m WHERE m.org_id = $1 AND ($3::uuid IS NULL OR m.id = $3)
       AND EXISTS (SELECT 1 FROM public.matter_members mm WHERE mm.matter_id = m.id AND mm.user_id = $2)
       AND NOT EXISTS (SELECT 1 FROM public.matter_barriers b WHERE b.matter_id = m.id AND b.user_id = $2)`,
    [orgId, userId, matterId],
  );
  void role;
  return r.rows.map((x) => x.id);
}

async function store(tx: Tx, orgId: string, matterId: string | null, bytes: Buffer, name: string, mime: string, createdBy: string | null): Promise<string> {
  const key = randomUUID();
  await blobStore.put(bytes, key);
  const sha = sha256Hex(bytes);
  const f = await tx.query<{ id: string }>(`INSERT INTO public.files (org_id, matter_id, scope, storage_key, original_name_raw, mime, size, sha256, scan_status, confidential, created_by) VALUES ($1, $2, 'export', $3, $4, $5, $6, $7, 'clean', true, $8) RETURNING id`, [orgId, matterId, key, name, mime, bytes.length, sha, createdBy]);
  await tx.query(`INSERT INTO public.file_versions (org_id, file_id, revision, storage_key, sha256, size, kind, created_by) VALUES ($1, $2, 1, $3, $4, $5, 'original', $6)`, [orgId, f.rows[0]!.id, key, sha, bytes.length, createdBy]);
  return f.rows[0]!.id;
}

const TABLES_BY_MATTER = ['matters', 'matter_members', 'matter_barriers', 'matter_parties', 'matter_agents', 'files', 'drafts', 'draft_revisions', 'draft_outputs', 'batches', 'batch_items', 'reviews', 'review_comments', 'evidence', 'packets', 'packet_items', 'dispatch_records', 'source_refs', 'audit_events'] as const;

export async function exportJob(ctx: JobContext, tx: Tx): Promise<Record<string, unknown>> {
  const p = ctx.job.payload as { type: string; matterId: string | null; encoding: 'utf8_bom' | 'cp932'; requestedBy: string; role: string };
  const orgId = ctx.job.org_id;
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  if (p.type === 'contacts_csv') {
    const r = await tx.query<Row>('SELECT external_id, type, name_raw, kana, organization_name_raw, address_raw, postcode_raw, channels_json, id, version FROM public.contacts WHERE org_id = $1 ORDER BY name_raw', [orgId]);
    const rows = r.rows.map((c) => ({ external_id: c.external_id ?? '', type: c.type, name_raw: c.name_raw, kana: c.kana, organization_name_raw: c.organization_name_raw, address_raw: c.address_raw, postcode_raw: c.postcode_raw, phone_raw: (c.channels_json as Record<string, string>)?.phone ?? '', email_raw: (c.channels_json as Record<string, string>)?.email ?? '', id: c.id, version: c.version }));
    const bytes = encodeCsv(rows, ['external_id', 'type', 'name_raw', 'kana', 'organization_name_raw', 'address_raw', 'postcode_raw', 'phone_raw', 'email_raw', 'id', 'version'], p.encoding);
    const json = Buffer.from(canonicalJson({ schemaVersion: 2, type: 'contacts', exportedAt: new Date().toISOString(), rows: r.rows }), 'utf8');
    const zip = await zipBuffer([{ name: 'contacts.csv', bytes }, { name: 'contacts.json', bytes: json }, { name: 'README.txt', bytes: Buffer.from('contacts.csv は表計算用（式注入対策で先頭に \' を付加した値があります）。原文完全保存は contacts.json を参照。\n', 'utf8') }]);
    const fileId = await store(tx, orgId, null, zip, `contacts_${ts}.zip`, 'application/zip', ctx.job.created_by);
    return { fileId, fileName: `contacts_${ts}.zip`, mime: 'application/zip', rows: rows.length };
  }
  if (p.type === 'matters_csv') {
    const ids = await accessibleMatters(tx, orgId, p.requestedBy, p.role, null);
    const r = await tx.query<Row>('SELECT external_id, title_raw, case_number_raw, court_raw, status, scope_raw, id, version FROM public.matters WHERE id = ANY($1::uuid[]) ORDER BY updated_at DESC', [ids]);
    const bytes = encodeCsv(r.rows, ['external_id', 'title_raw', 'case_number_raw', 'court_raw', 'status', 'scope_raw', 'id', 'version'], p.encoding);
    const fileId = await store(tx, orgId, null, bytes, `matters_${ts}.csv`, 'text/csv', ctx.job.created_by);
    return { fileId, fileName: `matters_${ts}.csv`, mime: 'text/csv', rows: r.rows.length };
  }
  if (p.type === 'evidence_csv') {
    const ids = await accessibleMatters(tx, orgId, p.requestedBy, p.role, p.matterId);
    if (!ids.length) throw new JobFailure('forbidden', '案件にアクセスできません', false);
    const r = await tx.query<Row>('SELECT display_label, symbol_raw, number_raw, branch_raw, canonical_number, title_raw, author_raw, date_raw, date_iso, original_copy, proof_purpose_raw, status, id, version FROM public.evidence WHERE matter_id = $1 ORDER BY created_at', [ids[0]]);
    const bytes = encodeCsv(r.rows, ['display_label', 'symbol_raw', 'number_raw', 'branch_raw', 'canonical_number', 'title_raw', 'author_raw', 'date_raw', 'date_iso', 'original_copy', 'proof_purpose_raw', 'status', 'id', 'version'], p.encoding);
    const fileId = await store(tx, orgId, ids[0]!, bytes, `evidence_${ts}.csv`, 'text/csv', ctx.job.created_by);
    return { fileId, fileName: `evidence_${ts}.csv`, mime: 'text/csv', rows: r.rows.length };
  }
  if (p.type === 'audit_csv') {
    const ids = await accessibleMatters(tx, orgId, p.requestedBy, p.role, p.matterId);
    const r = await tx.query<Row>(`SELECT a.created_at, a.action, a.target_type, a.target_id, a.target_version, a.target_hash, a.request_id, a.actor_id, u.display_name_raw AS actor_name, a.matter_id FROM public.audit_events a LEFT JOIN public.app_users u ON u.id = a.actor_id WHERE a.org_id = $1 AND (a.matter_id = ANY($2::uuid[]) OR (a.matter_id IS NULL AND $3 = 'admin')) ORDER BY a.created_at`, [orgId, ids, p.role]);
    const bytes = encodeCsv(r.rows, ['created_at', 'action', 'target_type', 'target_id', 'target_version', 'target_hash', 'request_id', 'actor_id', 'actor_name', 'matter_id'], p.encoding);
    const fileId = await store(tx, orgId, p.matterId, bytes, `audit_${ts}.csv`, 'text/csv', ctx.job.created_by);
    return { fileId, fileName: `audit_${ts}.csv`, mime: 'text/csv', rows: r.rows.length };
  }
  if (p.type === 'matter_json' || p.type === 'full_backup') {
    const full = p.type === 'full_backup';
    if (full && p.role !== 'admin') throw new JobFailure('forbidden', 'admin のみ', false);
    const ids = full ? (await tx.query<{ id: string }>('SELECT id FROM public.matters WHERE org_id = $1', [orgId])).rows.map((x) => x.id) : await accessibleMatters(tx, orgId, p.requestedBy, p.role, p.matterId);
    if (!full && !ids.length) throw new JobFailure('forbidden', '案件にアクセスできません', false);
    const dump: Record<string, unknown[]> = {};
    for (const t of TABLES_BY_MATTER) {
      const col = t === 'matters' ? 'id' : t === 'draft_revisions' ? null : t === 'draft_outputs' ? null : t === 'batch_items' ? null : t === 'reviews' ? null : t === 'review_comments' ? null : t === 'packet_items' ? null : 'matter_id';
      let rows: Row[];
      if (col) rows = (await tx.query<Row>(`SELECT * FROM public.${t} WHERE ${col} = ANY($1::uuid[])`, [ids])).rows;
      else if (t === 'draft_revisions') rows = (await tx.query<Row>(`SELECT r.* FROM public.draft_revisions r JOIN public.drafts d ON d.id = r.draft_id WHERE d.matter_id = ANY($1::uuid[])`, [ids])).rows;
      else if (t === 'draft_outputs') rows = (await tx.query<Row>(`SELECT o.* FROM public.draft_outputs o JOIN public.draft_revisions r ON r.id = o.revision_id JOIN public.drafts d ON d.id = r.draft_id WHERE d.matter_id = ANY($1::uuid[])`, [ids])).rows;
      else if (t === 'batch_items') rows = (await tx.query<Row>(`SELECT bi.* FROM public.batch_items bi JOIN public.batches b ON b.id = bi.batch_id WHERE b.matter_id = ANY($1::uuid[])`, [ids])).rows;
      else if (t === 'reviews') rows = (await tx.query<Row>(`SELECT rv.* FROM public.reviews rv JOIN public.draft_revisions r ON r.id = rv.revision_id JOIN public.drafts d ON d.id = r.draft_id WHERE d.matter_id = ANY($1::uuid[])`, [ids])).rows;
      else if (t === 'review_comments') rows = (await tx.query<Row>(`SELECT c.* FROM public.review_comments c JOIN public.reviews rv ON rv.id = c.review_id JOIN public.draft_revisions r ON r.id = rv.revision_id JOIN public.drafts d ON d.id = r.draft_id WHERE d.matter_id = ANY($1::uuid[])`, [ids])).rows;
      else rows = (await tx.query<Row>(`SELECT pi.* FROM public.packet_items pi JOIN public.packets p ON p.id = pi.packet_id WHERE p.matter_id = ANY($1::uuid[])`, [ids])).rows;
      dump[t] = rows;
    }
    if (full) {
      for (const t of ['organizations', 'memberships', 'app_users', 'office_profiles', 'lawyers', 'contacts', 'contact_aliases', 'contact_versions', 'templates', 'template_versions', 'phrase_libraries', 'phrase_versions', 'renderer_profiles', 'court_profiles', 'jobs', 'outbox']) {
        const hasOrg = !['app_users'].includes(t);
        const where = t === 'app_users' ? 'id IN (SELECT user_id FROM public.memberships WHERE org_id = $1)' : t === 'organizations' ? 'id = $1' : t === 'renderer_profiles' || t === 'court_profiles' ? '(org_id = $1 OR org_id IS NULL)' : 'org_id = $1';
        void hasOrg;
        dump[t] = (await tx.query<Row>(`SELECT * FROM public.${t} WHERE ${where}`, [orgId])).rows;
      }
      dump['files'] = (await tx.query<Row>('SELECT * FROM public.files WHERE org_id = $1', [orgId])).rows;
      dump['file_versions'] = (await tx.query<Row>('SELECT * FROM public.file_versions WHERE org_id = $1', [orgId])).rows;
    } else {
      // 案件で参照する連絡先と書式版
      const cids = new Set<string>();
      for (const r of dump.matter_parties as Row[]) { cids.add(r.contact_id as string); if (r.representative_id) cids.add(r.representative_id as string); }
      for (const r of dump.matter_agents as Row[]) cids.add(r.lawyer_contact_id as string);
      dump['contacts'] = cids.size ? (await tx.query<Row>('SELECT * FROM public.contacts WHERE id = ANY($1::uuid[])', [[...cids]])).rows : [];
      const tvids = [...new Set((dump.draft_revisions as Row[]).map((r) => r.template_version_id as string))];
      dump['template_versions'] = tvids.length ? (await tx.query<Row>('SELECT * FROM public.template_versions WHERE id = ANY($1::uuid[])', [tvids])).rows : [];
      dump['file_versions'] = (await tx.query<Row>('SELECT fv.* FROM public.file_versions fv JOIN public.files f ON f.id = fv.file_id WHERE f.matter_id = ANY($1::uuid[])', [ids])).rows;
    }
    // 添付（原本・出力）: storage_key → entries/<id>.bin（元ファイル名との対応は manifest）
    const entries: Array<{ name: string; bytes: Buffer }> = [];
    const blobManifest: Array<Record<string, unknown>> = [];
    const versions = dump['file_versions'] as Row[];
    let i = 0;
    for (const v of versions) {
      i += 1;
      if (!(await ctx.progress({ step: 'blobs', label: `${i}/${versions.length} 添付を収集中` }))) throw new JobFailure('cancelled', 'キャンセル', false);
      try {
        const bytes = await blobStore.get(v.storage_key as string);
        if (sha256Hex(bytes) !== v.sha256) throw new JobFailure('hash_mismatch', `blob ${v.id as string} の hash 不一致（storage 欠損/改変）`, false);
        const name = `blobs/${String(i).padStart(5, '0')}_${v.id as string}.bin`;
        entries.push({ name, bytes });
        blobManifest.push({ entry: name, fileVersionId: v.id, fileId: v.file_id, storageKey: v.storage_key, sha256: v.sha256, size: v.size, kind: v.kind });
      } catch (e) {
        if (e instanceof JobFailure) throw e;
        throw new JobFailure('blob_missing', `blob ${v.storage_key as string} を取得できません（添付と DB の片方だけの復元は完了扱いにしない）`, false);
      }
    }
    const dataJson = canonicalJson({ schemaVersion: 2, type: p.type, orgId, matterIds: ids, exportedAt: new Date().toISOString(), tables: dump, blobs: blobManifest, note: '原文・関係 ID・hash を含む。復元は空環境限定（scripts/restore.mjs）。' });
    const dataBytes = Buffer.from(dataJson, 'utf8');
    entries.unshift({ name: 'data.json', bytes: dataBytes });
    entries.push({ name: 'checksums.sha256', bytes: Buffer.from([`${sha256Hex(dataBytes)}  data.json`, ...blobManifest.map((b) => `${b.sha256 as string}  ${b.entry as string}`)].join('\n') + '\n', 'utf8') });
    const zip = await zipBuffer(entries);
    const name = full ? `raylow_full_backup_${ts}.zip` : `matter_${ids[0]}_${ts}.zip`;
    const fileId = await store(tx, orgId, full ? null : ids[0]!, zip, name, 'application/zip', ctx.job.created_by);
    return { fileId, fileName: name, mime: 'application/zip', tables: Object.keys(dump).length, blobs: blobManifest.length, sha256: sha256Hex(zip) };
  }
  throw new JobFailure('unknown_export', `未知の export 種別 ${p.type}`, false);
}
