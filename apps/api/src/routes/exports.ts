import type { FastifyInstance } from 'fastify';
import { ExportRequestSchema, ImportCommitSchema, ImportPreviewRequestSchema, type ImportPreviewResponseSchema } from '@raylow/contracts';
import { buildSearchKey } from '@raylow/japanese-text';
import { createHash, randomUUID } from 'node:crypto';
import type { z } from 'zod';
import { withUserTx, type Tx } from '../db/pool.js';
import { ApiError, conflict, notFound, validationFailed } from '../errors.js';
import { requireActor } from '../plugins/auth.js';
import { ok } from '../lib/reply.js';
import { parseOrThrow } from '../lib/validate.js';
import { audit } from '../services/audit.js';
import { enqueueJob } from '../services/jobs.js';
import { blobStore } from '../services/blobs.js';
import { decodeCsvStrict, parseCsvRows, validateImportRows, type ImportKind, type ImportRow } from '../services/csvImport.js';
import { contactSearchKey } from './masters.js';
import { matterSearchKey } from './matters.js';

type Row = Record<string, unknown>;

interface PendingImport { token: string; actorUserId: string; orgId: string; kind: ImportKind; rows: ImportRow[]; expiresAt: number }
const pendingImports = new Map<string, PendingImport>();
setInterval(() => { const now = Date.now(); for (const [k, v] of pendingImports) if (v.expiresAt < now) pendingImports.delete(k); }, 30_000).unref();

export async function exportRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/exports', async (req, reply) => {
    const actor = requireActor(req);
    const body = parseOrThrow(ExportRequestSchema, req.body);
    if ((body.type === 'matter_json' || body.type === 'evidence_csv') && !body.matterId) throw validationFailed([{ field: 'matterId', code: 'required', message: '案件を指定してください' }]);
    if (body.type === 'full_backup' && actor.role !== 'admin') throw new ApiError(403, 'forbidden', '全量バックアップは admin のみ要求できます');
    const data = await withUserTx(actor, async (tx) => {
      if (body.matterId) {
        const m = await tx.query('SELECT 1 FROM public.matters WHERE id = $1', [body.matterId]);
        if (!m.rowCount) throw notFound();
      }
      const job = await enqueueJob(tx, actor, { type: 'export', matterId: body.matterId ?? null, scopeKey: `export:${actor.userId}`, payload: { type: body.type, matterId: body.matterId ?? null, encoding: body.encoding, requestedBy: actor.userId, role: actor.role, nonce: Date.now() } });
      await audit(tx, actor, { action: 'export.requested', targetType: 'job', targetId: job.jobId, matterId: body.matterId ?? null, details: { type: body.type } });
      return { jobId: job.jobId };
    });
    return ok(req, reply, data, {}, 202);
  });

  app.get('/api/exports/:jobId/download', async (req, reply) => {
    const actor = requireActor(req);
    const { jobId } = req.params as { jobId: string };
    const { bytes, name, mime } = await withUserTx(actor, async (tx) => {
      const j = await tx.query<Row>('SELECT * FROM public.jobs WHERE id = $1 AND type = $2', [jobId, 'export']);
      const job = j.rows[0];
      if (!job) throw notFound();
      // 要求者本人のみ取得できる（admin の全量バックアップを他メンバーが取得できないようにする）
      if (job.created_by !== actor.userId) throw notFound();
      if (job.state !== 'succeeded') throw conflict('エクスポートはまだ完了していません');
      const result = (job.result as { fileId?: string; fileName?: string; mime?: string }) ?? {};
      if (!result.fileId) throw conflict('エクスポート結果がありません');
      const f = await tx.query<{ storage_key: string }>('SELECT storage_key FROM public.files WHERE id = $1', [result.fileId]);
      if (!f.rows[0]) throw notFound();
      await audit(tx, actor, { action: 'export.downloaded', targetType: 'file', targetId: result.fileId, matterId: (job.matter_id as string | null) ?? null });
      return { bytes: await blobStore.get(f.rows[0].storage_key), name: result.fileName ?? 'export.bin', mime: result.mime ?? 'application/octet-stream' };
    });
    reply.header('Content-Type', mime);
    reply.header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(name)}`);
    return reply.send(bytes);
  });

  // ---------- CSV インポート: preview（20 行）→ commit（全行検査後 transaction、1 行でもエラーなら全体停止） ----------
  app.post('/api/imports/preview', async (req, reply) => {
    const actor = requireActor(req);
    let fileBuf: Buffer | null = null;
    let fieldsRaw: unknown = {};
    for await (const part of req.parts()) {
      if (part.type === 'file') { fileBuf = await part.toBuffer(); }
      else if (part.fieldname === 'fields') { try { fieldsRaw = JSON.parse(String(part.value)); } catch { throw validationFailed([{ field: 'fields', code: 'invalid_json', message: 'fields は JSON' }]); } }
    }
    if (!fileBuf) throw validationFailed([{ field: 'file', code: 'required', message: 'CSV を添付してください' }]);
    if (fileBuf.length > 20 * 1024 * 1024) throw new ApiError(413, 'payload_too_large', 'CSV は 20MB までです');
    const fields = parseOrThrow(ImportPreviewRequestSchema, fieldsRaw);
    const decoded = decodeCsvStrict(fileBuf, fields.encoding);
    if (!decoded.ok) {
      const resp: z.infer<typeof ImportPreviewResponseSchema> = { importToken: '', kind: fields.kind, detectedEncoding: decoded.encoding, totalRows: 0, previewRows: [], errors: [{ row: 0, column: null, code: 'encoding_failed', message: decoded.error }], canCommit: false };
      return ok(req, reply, resp);
    }
    const parsed = parseCsvRows(decoded.text);
    if (!parsed.ok) {
      const resp: z.infer<typeof ImportPreviewResponseSchema> = { importToken: '', kind: fields.kind, detectedEncoding: decoded.encoding, totalRows: 0, previewRows: [], errors: [{ row: parsed.row, column: null, code: 'csv_parse_failed', message: parsed.error }], canCommit: false };
      return ok(req, reply, resp);
    }
    const errors = await withUserTx(actor, (tx) => validateImportRows(tx, actor.orgId, fields.kind, parsed.rows));
    const token = randomUUID();
    if (errors.length === 0) pendingImports.set(token, { token, actorUserId: actor.userId, orgId: actor.orgId, kind: fields.kind, rows: parsed.rows, expiresAt: Date.now() + 10 * 60_000 });
    const resp: z.infer<typeof ImportPreviewResponseSchema> = { importToken: errors.length === 0 ? token : '', kind: fields.kind, detectedEncoding: decoded.encoding, totalRows: parsed.rows.length, previewRows: parsed.rows.slice(0, 20), errors, canCommit: errors.length === 0 && parsed.rows.length > 0 };
    return ok(req, reply, resp);
  });

  app.post('/api/imports/commit', async (req, reply) => {
    const actor = requireActor(req);
    const body = parseOrThrow(ImportCommitSchema, req.body);
    const p = pendingImports.get(body.importToken);
    if (!p || p.actorUserId !== actor.userId || p.orgId !== actor.orgId || p.expiresAt < Date.now()) throw notFound('インポートのプレビューが見つからないか期限切れです。再度プレビューしてください');
    pendingImports.delete(body.importToken);
    const result = await withUserTx(actor, async (tx) => {
      // commit 直前に全行を再検査（preview 以降の競合を防ぐ）
      const errors = await validateImportRows(tx, actor.orgId, p.kind, p.rows);
      if (errors.length) throw new ApiError(422, 'validation_failed', `検査エラーのため全件を取り消しました（${errors.length} 件）`, { fieldErrors: errors.slice(0, 50).map((e) => ({ field: `row ${e.row}${e.column ? '.' + e.column : ''}`, code: e.code, message: e.message })) });
      let inserted = 0;
      let updated = 0;
      if (p.kind === 'contacts') {
        for (const r of p.rows) {
          const key = contactSearchKey({ nameRaw: r.name_raw ?? '', kana: r.kana ?? '', organizationNameRaw: r.organization_name_raw ?? '', addressRaw: r.address_raw ?? '' });
          const up = await tx.query<{ inserted: boolean }>(
            `INSERT INTO public.contacts (org_id, type, name_raw, kana, organization_name_raw, address_raw, postcode_raw, channels_json, external_id, search_key, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
             ON CONFLICT (org_id, external_id) WHERE external_id IS NOT NULL DO UPDATE SET type = EXCLUDED.type, name_raw = EXCLUDED.name_raw, kana = EXCLUDED.kana, organization_name_raw = EXCLUDED.organization_name_raw, address_raw = EXCLUDED.address_raw, postcode_raw = EXCLUDED.postcode_raw, channels_json = EXCLUDED.channels_json, search_key = EXCLUDED.search_key
             RETURNING (xmax = 0) AS inserted`,
            [actor.orgId, r.type, r.name_raw, r.kana ?? '', r.organization_name_raw ?? '', r.address_raw ?? '', r.postcode_raw ?? '', JSON.stringify({ phone: r.phone_raw ?? '', email: r.email_raw ?? '' }), r.external_id, key, actor.userId],
          );
          if (up.rows[0]?.inserted) inserted++; else updated++;
        }
      } else if (p.kind === 'matters') {
        for (const r of p.rows) {
          const key = matterSearchKey({ titleRaw: r.title_raw ?? '', caseNumberRaw: r.case_number_raw ?? '', courtRaw: r.court_raw ?? '' });
          // RLS 下では INSERT ... RETURNING が自分に見えない行で失敗するため、id を生成して挿入し、既存は SELECT で判定する
          const existing = await tx.query<{ id: string }>('SELECT id FROM public.matters WHERE org_id = $1 AND external_id = $2', [actor.orgId, r.external_id]);
          if (existing.rows[0]) {
            await tx.query(`UPDATE public.matters SET title_raw = $2, case_number_raw = $3, court_raw = $4, status = $5, scope_raw = $6, search_key = $7 WHERE id = $1`, [existing.rows[0].id, r.title_raw, r.case_number_raw ?? '', r.court_raw ?? '', r.status || 'active', r.scope_raw ?? '', key]);
            updated++;
            continue;
          }
          const id = randomUUID();
          await tx.query(`INSERT INTO public.matters (id, org_id, title_raw, case_number_raw, court_raw, status, scope_raw, external_id, search_key, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`, [id, actor.orgId, r.title_raw, r.case_number_raw ?? '', r.court_raw ?? '', r.status || 'active', r.scope_raw ?? '', r.external_id, key, actor.userId]);
          await tx.query('INSERT INTO public.matter_members (matter_id, user_id, org_id, can_edit, approved_by, created_by) VALUES ($1, $2, $3, true, $2, $2)', [id, actor.userId, actor.orgId]);
          inserted++;
        }
      } else {
        for (const r of p.rows) {
          const m = await tx.query<{ id: string }>('SELECT id FROM public.matters WHERE org_id = $1 AND external_id = $2', [actor.orgId, r.matter_external_id]);
          const c = await tx.query<{ id: string }>('SELECT id FROM public.contacts WHERE org_id = $1 AND external_id = $2', [actor.orgId, r.contact_external_id]);
          if (!m.rows[0] || !c.rows[0]) throw new ApiError(422, 'validation_failed', '未登録の外部 ID 参照があります');
          const dup = await tx.query('SELECT 1 FROM public.matter_parties WHERE matter_id = $1 AND contact_id = $2 AND role = $3', [m.rows[0].id, c.rows[0].id, r.role]);
          if (dup.rowCount) { updated++; continue; }
          await tx.query('INSERT INTO public.matter_parties (org_id, matter_id, contact_id, role, created_by) VALUES ($1, $2, $3, $4, $5)', [actor.orgId, m.rows[0].id, c.rows[0].id, r.role, actor.userId]);
          inserted++;
        }
      }
      await audit(tx, actor, { action: 'import.committed', targetType: 'import', targetId: null, details: { kind: p.kind, inserted, updated, rows: p.rows.length, sha256: createHash('sha256').update(JSON.stringify(p.rows)).digest('hex') } });
      return { inserted, updated };
    });
    return ok(req, reply, result);
  });
  void buildSearchKey;
  void ((_t: Tx) => undefined);
}
