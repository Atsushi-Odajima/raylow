import type { FastifyInstance } from 'fastify';
import { DispatchRecordInputSchema, DispatchVerifySchema, PacketCreateSchema, PacketUpdateSchema, type DispatchRecord, type Packet } from '@raylow/contracts';
import { withUserTx, type Actor, type Tx } from '../db/pool.js';
import { ApiError, conflict, forbidden, notFound, validationFailed, versionConflict } from '../errors.js';
import { requireActor } from '../plugins/auth.js';
import { ok } from '../lib/reply.js';
import { parseOrThrow } from '../lib/validate.js';
import { audit } from '../services/audit.js';
import { enqueueJob } from '../services/jobs.js';
import { blobStore } from '../services/blobs.js';

type Row = Record<string, unknown>;

async function loadPacket(tx: Tx, id: string): Promise<Packet> {
  const p = await tx.query<Row>('SELECT p.*, cp.name AS court_profile_name FROM public.packets p LEFT JOIN public.court_profiles cp ON cp.id = p.court_profile_id WHERE p.id = $1', [id]);
  const row = p.rows[0];
  if (!row) throw notFound();
  const items = await tx.query<Row>(
    `SELECT pi.*, o.format AS o_format, o.mode AS o_mode, o.sha256 AS o_sha, d.title_raw AS d_title, d.status AS d_status, d.approved_revision_id, o.revision_id AS o_rev,
            fv.sha256 AS fv_sha, fv.kind AS fv_kind, f.original_name_raw AS f_name, f.confidential AS f_conf, f.scan_status AS f_scan, e.display_label AS e_label
     FROM public.packet_items pi
     LEFT JOIN public.draft_outputs o ON o.id = pi.output_id LEFT JOIN public.draft_revisions r ON r.id = o.revision_id LEFT JOIN public.drafts d ON d.id = r.draft_id
     LEFT JOIN public.file_versions fv ON fv.id = pi.file_version_id LEFT JOIN public.files f ON f.id = fv.file_id
     LEFT JOIN public.evidence e ON e.id = pi.evidence_id
     WHERE pi.packet_id = $1 ORDER BY pi.order_no`,
    [id],
  );
  return {
    id: row.id as string, matterId: row.matter_id as string, revision: row.revision as number, titleRaw: row.title_raw as string, status: row.status as Packet['status'], courtProfileId: (row.court_profile_id as string | null) ?? null, courtProfileName: (row.court_profile_name as string | null) ?? null,
    items: items.rows.map((it) => ({
      id: it.id as string, outputId: (it.output_id as string | null) ?? null, fileVersionId: (it.file_version_id as string | null) ?? null, evidenceId: (it.evidence_id as string | null) ?? null, displayNameRaw: it.display_name_raw as string, orderNo: it.order_no as number, externalOutputConfirmed: it.external_output_confirmed as boolean,
      kind: it.output_id ? (it.o_format === 'pdf' ? 'document_pdf' : 'document_docx') : it.evidence_id ? 'evidence_pdf' : 'file',
      sourceLabel: it.output_id ? `${it.d_title as string}（${it.o_mode as string} ${it.o_format as string}）` : it.evidence_id ? `${it.e_label as string}\u3000${it.f_name as string}` : (it.f_name as string) ?? '',
      sha256: (it.o_sha as string | null) ?? (it.fv_sha as string | null) ?? null, confidential: (it.f_conf as boolean | null) ?? false,
      approved: it.output_id ? it.o_mode === 'final' && it.d_status === 'approved' && it.approved_revision_id === it.o_rev : null,
    })),
    manifest: (row.manifest_json as Record<string, unknown> | null) ?? null, hash: (row.hash as string | null) ?? null, fileId: (row.file_id as string | null) ?? null, checkReport: (row.check_report as Packet['checkReport']) ?? null, createdAt: row.created_at as string, updatedAt: row.updated_at as string, version: row.version as number,
  };
}

async function replaceItems(tx: Tx, packetId: string, orgId: string, matterId: string, items: Array<{ draftId?: string | null | undefined; outputId?: string | null | undefined; fileVersionId?: string | null | undefined; evidenceId?: string | null | undefined; displayNameRaw: string; orderNo: number; externalOutputConfirmed: boolean }>): Promise<void> {
  await tx.query('DELETE FROM public.packet_items WHERE packet_id = $1', [packetId]);
  const seen = new Set<number>();
  for (const raw of items) {
    const it = { ...raw };
    if (!it.outputId && it.draftId) {
      // 承認済み正式 PDF を解決（無ければ 422: 未完成項目へリンク）
      const o = await tx.query<{ id: string }>(`SELECT o.id FROM public.drafts d JOIN public.draft_outputs o ON o.revision_id = d.approved_revision_id WHERE d.id = $1 AND d.matter_id = $2 AND d.status = 'approved' AND o.mode = 'final' AND o.format = 'pdf' AND o.status = 'ready' ORDER BY o.created_at DESC LIMIT 1`, [it.draftId, matterId]);
      if (!o.rows[0]) throw validationFailed([{ field: 'items', code: 'draft_not_final', message: '承認済みの正式 PDF がない書類です。承認と正式出力を先に行ってください' }]);
      it.outputId = o.rows[0].id;
    }
    if (seen.has(it.orderNo)) throw validationFailed([{ field: 'items', code: 'duplicate_order', message: `順番 ${it.orderNo} が重複しています` }]);
    seen.add(it.orderNo);
    let fileVersionId = it.fileVersionId ?? null;
    if (it.evidenceId) {
      const ev = await tx.query<{ file_version_id: string | null; matter_id: string }>('SELECT file_version_id, matter_id FROM public.evidence WHERE id = $1', [it.evidenceId]);
      if (!ev.rows[0] || ev.rows[0].matter_id !== matterId) throw notFound();
      fileVersionId = fileVersionId ?? ev.rows[0].file_version_id;
    }
    if (it.outputId) {
      const o = await tx.query<{ matter_id: string }>('SELECT d.matter_id FROM public.draft_outputs o JOIN public.draft_revisions r ON r.id = o.revision_id JOIN public.drafts d ON d.id = r.draft_id WHERE o.id = $1', [it.outputId]);
      if (!o.rows[0] || o.rows[0].matter_id !== matterId) throw notFound();
    }
    if (fileVersionId) {
      const f = await tx.query<{ matter_id: string | null }>('SELECT f.matter_id FROM public.file_versions fv JOIN public.files f ON f.id = fv.file_id WHERE fv.id = $1', [fileVersionId]);
      if (!f.rows[0] || f.rows[0].matter_id !== matterId) throw notFound();
    }
    if (!it.outputId && !fileVersionId) throw validationFailed([{ field: 'items', code: 'empty_item', message: '書類または資料を指定してください' }]);
    if (fileVersionId && !it.fileVersionId) it.fileVersionId = fileVersionId;
    await tx.query('INSERT INTO public.packet_items (org_id, packet_id, output_id, file_version_id, evidence_id, order_no, display_name_raw, external_output_confirmed) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)', [orgId, packetId, it.outputId ?? null, fileVersionId, it.evidenceId ?? null, it.orderNo, it.displayNameRaw, it.externalOutputConfirmed]);
  }
}

/** 提出パック検査: 未承認/サンプル/未検査ファイル/機密未確認/欠落 */
export async function checkPacket(tx: Tx, packetId: string): Promise<Packet> {
  const p = await loadPacket(tx, packetId);
  const issues: NonNullable<Packet['checkReport']>['issues'] = [];
  if (p.items.length === 0) issues.push({ severity: 'error', code: 'no_items', message: '対象書類がありません' });
  for (const it of p.items) {
    if (it.outputId) {
      if (it.kind === 'document_docx') issues.push({ severity: 'warning', code: 'docx_in_pack', message: `${it.sourceLabel}: DOCX は提出用途では通常 PDF を使います`, itemId: it.id });
      if (it.approved !== true) issues.push({ severity: 'error', code: 'output_not_final_approved', message: `${it.sourceLabel}: 承認済みの正式版ではありません`, itemId: it.id, link: `/documents` });
      const o = await tx.query<{ sample_only: boolean }>('SELECT tv.sample_only FROM public.draft_outputs o JOIN public.draft_revisions r ON r.id = o.revision_id JOIN public.template_versions tv ON tv.id = r.template_version_id WHERE o.id = $1', [it.outputId]);
      if (o.rows[0]?.sample_only) issues.push({ severity: 'error', code: 'sample_only_template', message: `${it.sourceLabel}: サンプル書式で作成された文書です`, itemId: it.id });
    }
    if (it.fileVersionId) {
      const f = await tx.query<{ scan_status: string; kind: string; mime: string }>('SELECT f.scan_status, fv.kind, f.mime FROM public.file_versions fv JOIN public.files f ON f.id = fv.file_id WHERE fv.id = $1', [it.fileVersionId]);
      const fr = f.rows[0];
      if (!fr) issues.push({ severity: 'error', code: 'file_missing', message: `${it.sourceLabel}: 資料が見つかりません`, itemId: it.id });
      else {
        if (fr.scan_status !== 'clean') issues.push({ severity: 'error', code: 'file_not_scanned', message: `${it.sourceLabel}: 検査未完了または拒否（${fr.scan_status}）`, itemId: it.id });
        if (fr.kind === 'original' && fr.mime === 'application/pdf') issues.push({ severity: 'warning', code: 'original_not_derived', message: `${it.sourceLabel}: 原本 PDF です。派生提出用 PDF（メタデータ除去）が生成されるとそれを使います`, itemId: it.id });
        if (fr.mime !== 'application/pdf' && !fr.kind.includes('pdf')) issues.push({ severity: 'warning', code: 'non_pdf_attachment', message: `${it.sourceLabel}: PDF ではありません。提出先 profile の対応形式を確認してください`, itemId: it.id });
      }
      if (it.confidential && !it.externalOutputConfirmed) issues.push({ severity: 'error', code: 'confidential_not_confirmed', message: `${it.sourceLabel}: 機密資料の外部出力可否が未確認です`, itemId: it.id });
    }
    if (it.evidenceId) {
      const e = await tx.query<{ status: string }>('SELECT status FROM public.evidence WHERE id = $1', [it.evidenceId]);
      if (e.rows[0]?.status === 'draft') issues.push({ severity: 'warning', code: 'evidence_not_confirmed', message: `${it.sourceLabel}: 証拠番号が未確定です`, itemId: it.id, link: `/matters/${p.matterId}/evidence` });
      if (e.rows[0]?.status === 'superseded') issues.push({ severity: 'error', code: 'evidence_superseded', message: `${it.sourceLabel}: 訂正済みの旧版です`, itemId: it.id });
    }
  }
  if (!p.courtProfileId) issues.push({ severity: 'error', code: 'no_court_profile', message: '提出先 profile を選んでください' });
  else issues.push({ severity: 'warning', code: 'generic_profile_note', message: `適用 profile「${p.courtProfileName ?? ''}」は形式上の確認のみです。提出先の公式仕様を確認してください` });
  const blocking = issues.some((i) => i.severity === 'error');
  await tx.query(`UPDATE public.packets SET check_report = $2, status = $3 WHERE id = $1`, [packetId, JSON.stringify({ issues, blocking, checkedAt: new Date().toISOString() }), blocking ? 'blocked' : 'ready']);
  return loadPacket(tx, packetId);
}

function dispatchOut(r: Row): DispatchRecord {
  const snap = r.recipient_snapshot as DispatchRecord['recipientSnapshot'];
  return {
    id: r.id as string, matterId: r.matter_id as string, packetId: (r.packet_id as string | null) ?? null, outputId: (r.output_id as string | null) ?? null, recipientSnapshot: snap, method: r.method as DispatchRecord['method'], sentAt: r.sent_at as string, receiptRaw: r.receipt_raw as string, receiptFileId: (r.receipt_file_id as string | null) ?? null, receivedDocumentsRaw: r.received_documents_raw as string,
    status: r.status as DispatchRecord['status'], recordedBy: (r.recorded_by as string | null) ?? null, recordedByName: (r.recorded_by_name as string | null) ?? null, verifiedBy: (r.verified_by as string | null) ?? null, verifiedByName: (r.verified_by_name as string | null) ?? null, verifiedAt: (r.verified_at as string | null) ?? null, outputLabel: (r.output_label as string | null) ?? null, createdAt: r.created_at as string, version: r.version as number,
  };
}
const DISPATCH_SELECT = `SELECT dr.*, u1.display_name_raw AS recorded_by_name, u2.display_name_raw AS verified_by_name, COALESCE(d.title_raw, p.title_raw) AS output_label FROM public.dispatch_records dr LEFT JOIN public.app_users u1 ON u1.id = dr.recorded_by LEFT JOIN public.app_users u2 ON u2.id = dr.verified_by LEFT JOIN public.draft_outputs o ON o.id = dr.output_id LEFT JOIN public.draft_revisions r ON r.id = o.revision_id LEFT JOIN public.drafts d ON d.id = r.draft_id LEFT JOIN public.packets p ON p.id = dr.packet_id`;

export async function packetRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/packets', async (req, reply) => {
    const actor = requireActor(req);
    const body = parseOrThrow(PacketCreateSchema, req.body);
    const p = await withUserTx(actor, async (tx) => {
      const m = await tx.query<{ org_id: string }>('SELECT org_id FROM public.matters WHERE id = $1 AND app.can_edit_matter(id)', [body.matterId]);
      if (!m.rows[0]) throw notFound();
      const r = await tx.query<{ id: string }>(`INSERT INTO public.packets (org_id, matter_id, title_raw, status, court_profile_id, created_by) VALUES ($1, $2, $3, 'draft', $4, $5) RETURNING id`, [actor.orgId, body.matterId, body.titleRaw, body.courtProfileId, actor.userId]);
      await replaceItems(tx, r.rows[0]!.id, actor.orgId, body.matterId, body.items);
      await audit(tx, actor, { action: 'packet.created', targetType: 'packet', targetId: r.rows[0]!.id, matterId: body.matterId });
      return loadPacket(tx, r.rows[0]!.id);
    });
    return ok(req, reply, p, {}, 201);
  });
  app.get('/api/packets/:id', async (req, reply) => {
    const actor = requireActor(req);
    const { id } = req.params as { id: string };
    return ok(req, reply, await withUserTx(actor, (tx) => loadPacket(tx, id)));
  });
  app.put('/api/packets/:id', async (req, reply) => {
    const actor = requireActor(req);
    const { id } = req.params as { id: string };
    const body = parseOrThrow(PacketUpdateSchema, req.body);
    const p = await withUserTx(actor, async (tx) => {
      const cur = await tx.query<Row>('SELECT * FROM public.packets WHERE id = $1 FOR UPDATE', [id]);
      const c = cur.rows[0];
      if (!c) throw notFound();
      if ((c.version as number) !== body.expectedVersion) throw versionConflict(c.version as number);
      if (c.status === 'rendered' || c.status === 'archived') throw conflict('出力済みのパックは変更できません。新しいパックを作成してください');
      await tx.query(`UPDATE public.packets SET title_raw = COALESCE($3, title_raw), court_profile_id = COALESCE($4, court_profile_id), status = 'draft', check_report = NULL WHERE id = $1 AND version = $2`, [id, body.expectedVersion, body.titleRaw ?? null, body.courtProfileId ?? null]);
      await replaceItems(tx, id, c.org_id as string, c.matter_id as string, body.items);
      await audit(tx, actor, { action: 'packet.updated', targetType: 'packet', targetId: id, matterId: c.matter_id as string });
      return loadPacket(tx, id);
    });
    return ok(req, reply, p);
  });
  app.post('/api/packets/:id/check', async (req, reply) => {
    const actor = requireActor(req);
    const { id } = req.params as { id: string };
    const p = await withUserTx(actor, async (tx) => {
      const cur = await tx.query('SELECT 1 FROM public.packets WHERE id = $1', [id]);
      if (!cur.rowCount) throw notFound();
      const out = await checkPacket(tx, id);
      await audit(tx, actor, { action: 'packet.checked', targetType: 'packet', targetId: id, matterId: out.matterId, details: { blocking: out.checkReport?.blocking } });
      return out;
    });
    return ok(req, reply, p);
  });
  // 全件完成が必要な正式提出パックは欠落があれば出力不可
  app.post('/api/packets/:id/render', async (req, reply) => {
    const actor = requireActor(req);
    const { id } = req.params as { id: string };
    const data = await withUserTx(actor, async (tx) => {
      const p = await checkPacket(tx, id);
      if (p.checkReport?.blocking) throw new ApiError(422, 'precondition_failed', '未完成の項目があるため提出パックを出力できません', { details: { issues: p.checkReport.issues.filter((i) => i.severity === 'error') } });
      const job = await enqueueJob(tx, actor, { type: 'render_packet', matterId: p.matterId, scopeKey: `packet:${id}`, payload: { packetId: id, itemIds: p.items.map((i) => i.id), version: p.version } });
      await tx.query(`UPDATE public.packets SET status = 'rendering' WHERE id = $1`, [id]);
      await audit(tx, actor, { action: 'packet.render_requested', targetType: 'packet', targetId: id, matterId: p.matterId, details: { jobId: job.jobId } });
      return { jobId: job.jobId };
    });
    return ok(req, reply, data, {}, 202);
  });
  app.get('/api/packets/:id/download', async (req, reply) => {
    const actor = requireActor(req);
    const { id } = req.params as { id: string };
    const { bytes, name } = await withUserTx(actor, async (tx) => {
      const p = await tx.query<Row>('SELECT p.*, f.storage_key FROM public.packets p JOIN public.files f ON f.id = p.file_id WHERE p.id = $1', [id]);
      const row = p.rows[0];
      if (!row) throw notFound();
      if (row.status !== 'rendered') throw conflict('パックはまだ出力されていません');
      await audit(tx, actor, { action: 'packet.downloaded', targetType: 'packet', targetId: id, targetHash: row.hash as string, matterId: row.matter_id as string, details: { note: 'ダウンロードは提出済みを意味しない' } });
      return { bytes: await blobStore.get(row.storage_key as string), name: `${(row.title_raw as string) || 'packet'}_r${row.revision as number}.zip` };
    });
    reply.header('Content-Type', 'application/zip');
    reply.header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(name)}`);
    return reply.send(bytes);
  });

  // ---------- 送付/提出記録（manual、別状態） ----------
  app.post('/api/dispatch-records', async (req, reply) => {
    const actor = requireActor(req);
    const body = parseOrThrow(DispatchRecordInputSchema, req.body);
    if (!body.packetId && !body.outputId) throw validationFailed([{ field: 'outputId', code: 'required', message: '出した版（出力またはパック）を指定してください' }]);
    const d = await withUserTx(actor, async (tx) => {
      const m = await tx.query<{ org_id: string }>('SELECT org_id FROM public.matters WHERE id = $1 AND app.can_edit_matter(id)', [body.matterId]);
      if (!m.rows[0]) throw notFound();
      if (body.outputId) {
        const o = await tx.query<{ matter_id: string; mode: string }>('SELECT d.matter_id, o.mode FROM public.draft_outputs o JOIN public.draft_revisions r ON r.id = o.revision_id JOIN public.drafts d ON d.id = r.draft_id WHERE o.id = $1', [body.outputId]);
        if (!o.rows[0] || o.rows[0].matter_id !== body.matterId) throw notFound();
      }
      const r = await tx.query<{ id: string }>(
        `INSERT INTO public.dispatch_records (org_id, matter_id, packet_id, output_id, recipient_snapshot, method, sent_at, receipt_raw, receipt_file_id, received_documents_raw, status, recorded_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'recorded', $11) RETURNING id`,
        [m.rows[0].org_id, body.matterId, body.packetId ?? null, body.outputId ?? null, JSON.stringify(body.recipientSnapshot), body.methodNoteRaw ? `${body.method}:${body.methodNoteRaw}` : body.method, body.sentAt, body.receiptRaw, body.receiptFileId ?? null, body.receivedDocumentsRaw, actor.userId],
      );
      if (body.packetId) {
        // パックに含めた証拠は提出済み扱い（以後の改番は禁止。訂正は履歴付き別版）
        await tx.query(`UPDATE public.evidence SET status = 'submitted' WHERE status = 'confirmed' AND id IN (SELECT evidence_id FROM public.packet_items WHERE packet_id = $1 AND evidence_id IS NOT NULL)`, [body.packetId]);
      }
      await audit(tx, actor, { action: 'dispatch.recorded', targetType: 'dispatch_record', targetId: r.rows[0]!.id, matterId: body.matterId, details: { method: body.method } });
      const row = await tx.query<Row>(`${DISPATCH_SELECT} WHERE dr.id = $1`, [r.rows[0]!.id]);
      return dispatchOut(row.rows[0]!);
    });
    return ok(req, reply, d, {}, 201);
  });
  app.get('/api/dispatch-records/:id', async (req, reply) => {
    const actor = requireActor(req);
    const { id } = req.params as { id: string };
    const d = await withUserTx(actor, async (tx) => {
      const r = await tx.query<Row>(`${DISPATCH_SELECT} WHERE dr.id = $1`, [id]);
      if (!r.rows[0]) throw notFound();
      return dispatchOut(r.rows[0]);
    });
    return ok(req, reply, d);
  });
  app.get('/api/matters/:id/dispatches', async (req, reply) => {
    const actor = requireActor(req);
    const { id } = req.params as { id: string };
    const rows = await withUserTx(actor, (tx) => tx.query<Row>(`${DISPATCH_SELECT} WHERE dr.matter_id = $1 ORDER BY dr.sent_at DESC`, [id]).then((r) => r.rows));
    return ok(req, reply, rows.map(dispatchOut));
  });
  // 他担当者が確認し received_verified へ
  app.post('/api/dispatch-records/:id/verify', async (req, reply) => {
    const actor = requireActor(req);
    const { id } = req.params as { id: string };
    const body = parseOrThrow(DispatchVerifySchema, req.body);
    const d = await withUserTx(actor, async (tx) => {
      const cur = await tx.query<Row>('SELECT * FROM public.dispatch_records WHERE id = $1 FOR UPDATE', [id]);
      const c = cur.rows[0];
      if (!c) throw notFound();
      if ((c.version as number) !== body.expectedVersion) throw versionConflict(c.version as number);
      if (c.recorded_by === actor.userId) throw forbidden('記録者本人は確認できません。他の担当者が確認します');
      await tx.query(`UPDATE public.dispatch_records SET status = 'received_verified', verified_by = $3, verified_at = now() WHERE id = $1 AND version = $2`, [id, body.expectedVersion, actor.userId]);
      await audit(tx, actor, { action: 'dispatch.verified', targetType: 'dispatch_record', targetId: id, matterId: c.matter_id as string });
      const r = await tx.query<Row>(`${DISPATCH_SELECT} WHERE dr.id = $1`, [id]);
      return dispatchOut(r.rows[0]!);
    });
    return ok(req, reply, d);
  });
  void ((_a: Actor) => undefined);
}
