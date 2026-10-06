import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ApplyCandidatesSchema, DraftCreateSchema, DraftLeaseRequestSchema, DraftListQuerySchema, DraftRevisionInputSchema, RenderRequestSchema, ReviewRequestCreateSchema, type DraftSnapshot } from '@raylow/contracts';
import { EDIT_LEASE_SECONDS, canTransitionDraft } from '@raylow/domain';
import { DocumentASTSchema, emptyAST, validateUniqueBlockIds, type DocumentAST } from '@raylow/template-schema';
import { withUserTx, type Actor, type Tx } from '../db/pool.js';
import { ApiError, conflict, forbidden, notFound, validationFailed, versionConflict } from '../errors.js';
import { requireActor } from '../plugins/auth.js';
import { ok } from '../lib/reply.js';
import { decodeCursor, encodeCursor, parseOrThrow } from '../lib/validate.js';
import { audit } from '../services/audit.js';
import { enqueueJob } from '../services/jobs.js';
import { buildInitialFields, buildRecipientSnapshot, computeRefreshCandidates, loadSources, revisionHash, templateSchemaOf } from '../services/drafts.js';
import { DRAFT_SELECT, buildPreflight, draftOut, loadDraftDetail, loadDraftRow, loadRevision, outputOut, revisionOut } from '../services/draftDetail.js';
import { blobStore } from '../services/blobs.js';
import { storeUploadedFile } from '../services/files.js';

type Row = Record<string, unknown>;

async function assertLeaseOrFree(tx: Tx, actor: Actor, draftId: string): Promise<void> {
  const l = await tx.query<{ user_id: string; display_name_raw: string; expires_at: string }>('SELECT l.user_id, u.display_name_raw, l.expires_at FROM public.edit_leases l JOIN public.app_users u ON u.id = l.user_id WHERE l.draft_id = $1 AND l.expires_at > now()', [draftId]);
  const row = l.rows[0];
  if (row && row.user_id !== actor.userId) throw new ApiError(409, 'lease_held', `${row.display_name_raw} が編集中です（${row.expires_at} まで）。引継ぎには理由が必要です`, { details: { holderUserId: row.user_id, expiresAt: row.expires_at } });
}

async function insertRevision(tx: Tx, actor: Actor, draft: Row, templateVersionId: string, snapshot: DraftSnapshot, ast: DocumentAST, sourceRevisionId: string | null, kind: 'app' | 'external_edit' = 'app', externalFileVersionId: string | null = null): Promise<Row> {
  const hash = await revisionHash(snapshot, ast, templateVersionId);
  const rev = await tx.query<{ n: number }>('SELECT COALESCE(max(revision), 0) + 1 AS n FROM public.draft_revisions WHERE draft_id = $1', [draft.id]);
  const r = await tx.query<Row>(
    `INSERT INTO public.draft_revisions (org_id, draft_id, revision, template_version_id, snapshot_json, ast_json, source_revision_id, kind, external_file_version_id, hash, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
    [draft.org_id, draft.id, rev.rows[0]!.n, templateVersionId, JSON.stringify(snapshot), JSON.stringify(ast), sourceRevisionId, kind, externalFileVersionId, hash, actor.userId],
  );
  return r.rows[0]!;
}

/** 編集・宛先変更・書式変更・外部編集版追加で承認を失効 */
async function setCurrentRevision(tx: Tx, actor: Actor, draft: Row, revision: Row, expectedVersion: number, action: string): Promise<void> {
  const prevStatus = draft.status as string;
  const nextStatus = prevStatus === 'approved' || prevStatus === 'in_review' || prevStatus === 'ready_for_review' || prevStatus === 'changes_requested' || prevStatus === 'rendering' ? 'draft' : prevStatus;
  if (!canTransitionDraft(prevStatus as 'draft', nextStatus as 'draft') && prevStatus !== nextStatus) throw conflict(`状態 ${prevStatus} からは編集できません`);
  const r = await tx.query<{ version: number }>(`UPDATE public.drafts SET current_revision_id = $3, status = $4 WHERE id = $1 AND version = $2 RETURNING version`, [draft.id, expectedVersion, revision.id, nextStatus]);
  if (!r.rows[0]) {
    const cur = await tx.query<{ version: number }>('SELECT version FROM public.drafts WHERE id = $1', [draft.id]);
    if (!cur.rows[0]) throw notFound();
    throw versionConflict(cur.rows[0].version);
  }
  if (prevStatus === 'approved') {
    await tx.query(`UPDATE public.reviews SET status = 'withdrawn', decision_reason = COALESCE(decision_reason, '') || ' [編集により承認失効]' WHERE revision_id = $1 AND status = 'approved'`, [draft.current_revision_id]);
  }
  await tx.query(`UPDATE public.reviews SET status = 'withdrawn' WHERE status = 'pending' AND revision_id IN (SELECT id FROM public.draft_revisions WHERE draft_id = $1)`, [draft.id]);
  await audit(tx, actor, { action, targetType: 'draft', targetId: draft.id as string, targetVersion: r.rows[0].version, targetHash: revision.hash as string, matterId: draft.matter_id as string, details: { revision: revision.revision, approvalInvalidated: prevStatus === 'approved' } });
}

export async function draftRoutes(app: FastifyInstance): Promise<void> {
  // ---------- 作成（自動差込で revision 1） ----------
  app.post('/api/drafts', async (req, reply) => {
    const actor = requireActor(req);
    const body = parseOrThrow(DraftCreateSchema, req.body);
    const detail = await withUserTx(actor, async (tx) => {
      const existing = await tx.query<{ id: string }>('SELECT id FROM public.drafts WHERE org_id = $1 AND idempotency_key = $2', [actor.orgId, body.idempotencyKey]);
      if (existing.rows[0]) return loadDraftDetail(tx, actor, existing.rows[0].id);
      const edit = await tx.query<{ ok: boolean }>('SELECT app.can_edit_matter($1) AS ok', [body.matterId]);
      if (!edit.rows[0]?.ok) throw notFound();
      const tv = await tx.query<Row>('SELECT tv.*, t.name AS template_name FROM public.template_versions tv JOIN public.templates t ON t.id = tv.template_id WHERE tv.id = $1 AND tv.org_id = $2', [body.templateVersionId, actor.orgId]);
      const tvRow = tv.rows[0];
      if (!tvRow) throw notFound();
      if (tvRow.status !== 'published') throw new ApiError(422, 'template_not_published', '公開されていない書式版は選べません', { fieldErrors: [{ field: 'templateVersionId', code: 'not_published', message: '公開済みの書式版を選んでください' }] });
      const schema = templateSchemaOf(tvRow);
      if (!schema.recipientTypes.includes(body.recipientType)) throw validationFailed([{ field: 'recipientType', code: 'invalid', message: 'この書式では選べない宛先種別です' }]);
      if (body.recipientType !== 'none' && body.recipientType !== 'court' && !body.recipientContactId) throw validationFailed([{ field: 'recipientContactId', code: 'required', message: '宛先を選んでください' }]);
      const src = await loadSources(tx, body.matterId, body.recipientContactId ?? null, null);
      // 受任通知: 受任確認済みが正式版の条件（草案作成は可、preflight で警告）
      const recipient = buildRecipientSnapshot(body.recipientType, src.recipient, src.honorificSettings, body.confirmDirectToOpponent);
      if (body.recipientType === 'opponent') {
        const agents = await tx.query<{ n: string }>(`SELECT count(*) AS n FROM public.matter_agents a JOIN public.matter_parties p ON p.id = a.represented_party_id WHERE a.matter_id = $1 AND p.role = 'opponent' AND (a.valid_to IS NULL OR a.valid_to >= current_date)`, [body.matterId]);
        if (Number(agents.rows[0]!.n) > 0 && !body.confirmDirectToOpponent) throw new ApiError(422, 'precondition_failed', '相手方代理人が登録されています。本人宛てにする場合は確認が必要です（可否はシステムが判定しません）', { fieldErrors: [{ field: 'confirmDirectToOpponent', code: 'confirmation_required', message: '確認してください' }] });
      }
      const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
      const fields = buildInitialFields(schema, src, recipient, today);
      const snapshot: DraftSnapshot = {
        schemaVersion: 1,
        fields,
        recipient,
        attachments: [],
        sources: { officeProfileId: (src.office?.id as string) ?? null, officeProfileRevision: src.office ? Number(src.office.revision) : null, matterVersion: Number(src.matter.version), lawyerId: (src.lawyer?.id as string) ?? null, lawyerVersion: src.lawyer ? Number(src.lawyer.version) : null, templateVersionId: body.templateVersionId, phraseVersionIds: [] },
        issueDate: today,
      };
      const title = body.titleRaw ?? `${tvRow.template_name as string}（${recipient.nameRaw || (body.recipientType === 'court' ? (src.matter.court_raw as string) || '裁判所' : '宛先なし')}）`;
      const d = await tx.query<Row>(
        `INSERT INTO public.drafts (org_id, matter_id, template_id, kind, title_raw, status, recipient_type, recipient_contact_id, idempotency_key, created_by) VALUES ($1, $2, $3, $4, $5, 'draft', $6, $7, $8, $9) RETURNING *`,
        [actor.orgId, body.matterId, tvRow.template_id, tvRow.kind, title, body.recipientType, body.recipientContactId ?? null, body.idempotencyKey, actor.userId],
      );
      const draft = d.rows[0]!;
      const rev = await insertRevision(tx, actor, draft, body.templateVersionId, snapshot, emptyAST(), null);
      await tx.query('UPDATE public.drafts SET current_revision_id = $2 WHERE id = $1', [draft.id, rev.id]);
      await audit(tx, actor, { action: 'draft.created', targetType: 'draft', targetId: draft.id as string, targetVersion: 1, targetHash: rev.hash as string, matterId: body.matterId, details: { templateVersionId: body.templateVersionId, recipientType: body.recipientType } });
      return loadDraftDetail(tx, actor, draft.id as string);
    });
    return ok(req, reply, detail, {}, 201);
  });

  app.get('/api/drafts/:id', async (req, reply) => {
    const actor = requireActor(req);
    const { id } = req.params as { id: string };
    return ok(req, reply, await withUserTx(actor, (tx) => loadDraftDetail(tx, actor, id)));
  });

  // ---------- 新 revision ----------
  app.put('/api/drafts/:id/revisions', async (req, reply) => {
    const actor = requireActor(req);
    const { id } = req.params as { id: string };
    const body = parseOrThrow(DraftRevisionInputSchema, req.body);
    const dup = validateUniqueBlockIds(body.ast);
    if (dup.length) throw validationFailed(dup.map((d) => ({ field: `ast.blocks.${d}`, code: 'duplicate_block_id', message: `block id ${d} が重複しています` })));
    const detail = await withUserTx(actor, async (tx) => {
      const draft = await loadDraftRow(tx, id);
      if ((draft.version as number) !== body.expectedVersion) throw versionConflict(draft.version as number);
      if (['superseded', 'archived'].includes(draft.status as string)) throw conflict('この草案は編集できません');
      await assertLeaseOrFree(tx, actor, id);
      const cur = await loadRevision(tx, draft.current_revision_id as string);
      if (!cur) throw notFound();
      const tv = await tx.query<Row>('SELECT * FROM public.template_versions WHERE id = $1', [cur.templateVersionId]);
      const schema = templateSchemaOf(tv.rows[0]!);
      const allowed = new Set(schema.fields.map((f) => f.key));
      const fields: DraftSnapshot['fields'] = {};
      for (const [k, v] of Object.entries(body.fields)) {
        if (!allowed.has(k)) continue; // スキーマ外キーは無視（任意キー注入防止）
        const prev = cur.snapshot.fields[k];
        const changedFromSource = prev && prev.sourceId != null && String(prev.rawValue ?? '') !== String(v.rawValue ?? '');
        fields[k] = { rawValue: v.rawValue, sourceId: v.sourceId ?? prev?.sourceId ?? null, sourceVersion: v.sourceVersion ?? prev?.sourceVersion ?? null, manuallyOverridden: v.manuallyOverridden ?? (prev?.manuallyOverridden === true || changedFromSource === true) };
        if (v.displayValue !== undefined) fields[k]!.displayValue = v.displayValue;
      }
      for (const f of schema.fields) if (!fields[f.key] && cur.snapshot.fields[f.key]) fields[f.key] = cur.snapshot.fields[f.key]!;
      const snapshot: DraftSnapshot = { ...cur.snapshot, fields, attachments: body.attachments, issueDate: body.issueDate === undefined ? cur.snapshot.issueDate : body.issueDate, sources: { ...cur.snapshot.sources, phraseVersionIds: body.phraseVersionIds ?? cur.snapshot.sources.phraseVersionIds } };
      const rev = await insertRevision(tx, actor, draft, cur.templateVersionId, snapshot, body.ast, cur.id);
      await setCurrentRevision(tx, actor, draft, rev, body.expectedVersion, 'draft.revision_saved');
      return loadDraftDetail(tx, actor, id);
    });
    return ok(req, reply, detail);
  });

  // ---------- lease（90 秒 / heartbeat 30 秒、強制引継ぎに理由） ----------
  app.post('/api/drafts/:id/lease', async (req, reply) => {
    const actor = requireActor(req);
    const { id } = req.params as { id: string };
    const body = parseOrThrow(DraftLeaseRequestSchema, req.body ?? {});
    const lease = await withUserTx(actor, async (tx) => {
      const draft = await loadDraftRow(tx, id);
      const edit = await tx.query<{ ok: boolean }>('SELECT app.can_edit_matter($1) AS ok', [draft.matter_id]);
      if (!edit.rows[0]?.ok) throw forbidden('この案件の編集権限がありません');
      const cur = await tx.query<{ user_id: string; display_name_raw: string; expires_at: string }>('SELECT l.user_id, u.display_name_raw, l.expires_at FROM public.edit_leases l JOIN public.app_users u ON u.id = l.user_id WHERE l.draft_id = $1 FOR UPDATE', [id]);
      const held = cur.rows[0];
      if (held && held.user_id !== actor.userId && new Date(held.expires_at).getTime() > Date.now()) {
        if (!body.takeoverReason) throw new ApiError(409, 'lease_held', `${held.display_name_raw} が編集中です。引継ぐには理由を入力してください`, { details: { holderUserId: held.user_id, holderName: held.display_name_raw, expiresAt: held.expires_at } });
        await audit(tx, actor, { action: 'draft.lease_takeover', targetType: 'draft', targetId: id, matterId: draft.matter_id as string, details: { from: held.user_id, reason: body.takeoverReason } });
      }
      const r = await tx.query<Row>(
        `INSERT INTO public.edit_leases (draft_id, org_id, user_id, expires_at, takeover_reason) VALUES ($1, $2, $3, now() + make_interval(secs => $4), $5)
         ON CONFLICT (draft_id) DO UPDATE SET user_id = EXCLUDED.user_id, expires_at = EXCLUDED.expires_at, takeover_reason = EXCLUDED.takeover_reason, updated_at = now() RETURNING *`,
        [id, draft.org_id, actor.userId, EDIT_LEASE_SECONDS, body.takeoverReason ?? null],
      );
      const u = await tx.query<{ display_name_raw: string }>('SELECT display_name_raw FROM public.app_users WHERE id = $1', [actor.userId]);
      return { draftId: id, userId: actor.userId, userName: u.rows[0]?.display_name_raw ?? '', expiresAt: r.rows[0]!.expires_at as string, mine: true };
    });
    return ok(req, reply, lease);
  });
  app.delete('/api/drafts/:id/lease', async (req, reply) => {
    const actor = requireActor(req);
    const { id } = req.params as { id: string };
    await withUserTx(actor, (tx) => tx.query('DELETE FROM public.edit_leases WHERE draft_id = $1 AND user_id = $2', [id, actor.userId]));
    return ok(req, reply, { released: true });
  });

  // ---------- 更新候補 ----------
  app.post('/api/drafts/:id/refresh-candidates', async (req, reply) => {
    const actor = requireActor(req);
    const { id } = req.params as { id: string };
    const data = await withUserTx(actor, async (tx) => {
      const draft = await loadDraftRow(tx, id);
      const cur = await loadRevision(tx, draft.current_revision_id as string);
      if (!cur) throw notFound();
      const tv = await tx.query<Row>('SELECT * FROM public.template_versions WHERE id = $1', [cur.templateVersionId]);
      const schema = templateSchemaOf(tv.rows[0]!);
      const src = await loadSources(tx, draft.matter_id as string, cur.snapshot.recipient.contactId, cur.snapshot.sources.lawyerId);
      const recipient = buildRecipientSnapshot(cur.snapshot.recipient.type, src.recipient, src.honorificSettings, cur.snapshot.recipient.confirmedDirectToOpponent);
      return { candidates: computeRefreshCandidates(schema, cur.snapshot.fields, src, recipient) };
    });
    return ok(req, reply, data);
  });
  app.post('/api/drafts/:id/apply-candidates', async (req, reply) => {
    const actor = requireActor(req);
    const { id } = req.params as { id: string };
    const body = parseOrThrow(ApplyCandidatesSchema, req.body);
    const detail = await withUserTx(actor, async (tx) => {
      const draft = await loadDraftRow(tx, id);
      if ((draft.version as number) !== body.expectedVersion) throw versionConflict(draft.version as number);
      await assertLeaseOrFree(tx, actor, id);
      const cur = await loadRevision(tx, draft.current_revision_id as string);
      if (!cur) throw notFound();
      const tv = await tx.query<Row>('SELECT * FROM public.template_versions WHERE id = $1', [cur.templateVersionId]);
      const schema = templateSchemaOf(tv.rows[0]!);
      const src = await loadSources(tx, draft.matter_id as string, cur.snapshot.recipient.contactId, cur.snapshot.sources.lawyerId);
      const recipient = buildRecipientSnapshot(cur.snapshot.recipient.type, src.recipient, src.honorificSettings, cur.snapshot.recipient.confirmedDirectToOpponent);
      const cands = computeRefreshCandidates(schema, cur.snapshot.fields, src, recipient);
      const fields = { ...cur.snapshot.fields };
      for (const c of cands) {
        if (!body.fieldKeys.includes(c.fieldKey)) continue;
        fields[c.fieldKey] = { rawValue: c.newValue, sourceId: c.sourceId, sourceVersion: c.sourceVersion, manuallyOverridden: false };
      }
      const snapshot: DraftSnapshot = { ...cur.snapshot, fields, recipient: body.fieldKeys.some((k) => k.startsWith('recipient')) ? recipient : cur.snapshot.recipient, sources: { ...cur.snapshot.sources, officeProfileId: (src.office?.id as string) ?? null, officeProfileRevision: src.office ? Number(src.office.revision) : null, matterVersion: Number(src.matter.version), lawyerVersion: src.lawyer ? Number(src.lawyer.version) : null } };
      const rev = await insertRevision(tx, actor, draft, cur.templateVersionId, snapshot, cur.ast, cur.id);
      await setCurrentRevision(tx, actor, draft, rev, body.expectedVersion, 'draft.candidates_applied');
      return loadDraftDetail(tx, actor, id);
    });
    return ok(req, reply, detail);
  });

  // ---------- render ----------
  app.post('/api/drafts/:id/render', async (req, reply) => {
    const actor = requireActor(req);
    const { id } = req.params as { id: string };
    const body = parseOrThrow(RenderRequestSchema, req.body ?? {});
    const data = await withUserTx(actor, async (tx) => {
      const draft = await loadDraftRow(tx, id);
      const edit = await tx.query<{ ok: boolean }>('SELECT app.can_edit_matter($1) AS ok', [draft.matter_id]);
      if (!edit.rows[0]?.ok && body.mode === 'draft') throw forbidden();
      let revisionId = draft.current_revision_id as string;
      if (body.mode === 'final') {
        if (draft.status !== 'approved' || !draft.approved_revision_id) throw conflict('正式版は承認済みの草案のみ出力できます', 'precondition_failed');
        revisionId = draft.approved_revision_id as string;
        const tv = await tx.query<{ sample_only: boolean }>('SELECT tv.sample_only FROM public.template_versions tv JOIN public.draft_revisions r ON r.template_version_id = tv.id WHERE r.id = $1', [revisionId]);
        if (tv.rows[0]?.sample_only) throw new ApiError(409, 'template_sample_only', 'サンプル書式では正式出力できません。所内承認済みの書式版が必要です');
      }
      const rev = await tx.query<{ hash: string }>('SELECT hash FROM public.draft_revisions WHERE id = $1', [revisionId]);
      const r = await enqueueJob(tx, actor, { type: body.mode === 'final' ? 'render_final' : 'render_draft', matterId: draft.matter_id as string, scopeKey: `draft:${id}`, payload: { draftId: id, revisionId, mode: body.mode, hash: rev.rows[0]!.hash } });
      if (!r.deduplicated) {
        if (body.mode === 'draft' && draft.status === 'draft') await tx.query(`UPDATE public.drafts SET status = 'rendering' WHERE id = $1 AND status = 'draft'`, [id]);
        await audit(tx, actor, { action: 'draft.render_requested', targetType: 'draft', targetId: id, matterId: draft.matter_id as string, details: { mode: body.mode, jobId: r.jobId } });
      }
      return r;
    });
    return ok(req, reply, { jobId: data.jobId, deduplicated: data.deduplicated }, {}, 202);
  });

  app.get('/api/drafts/:id/preflight', async (req, reply) => {
    const actor = requireActor(req);
    const { id } = req.params as { id: string };
    const report = await withUserTx(actor, async (tx) => {
      const draft = await loadDraftRow(tx, id);
      const cur = await loadRevision(tx, draft.current_revision_id as string);
      return buildPreflight(tx, draft, cur);
    });
    return ok(req, reply, report);
  });

  // ---------- レビュー依頼 ----------
  app.post('/api/drafts/:id/request-review', async (req, reply) => {
    const actor = requireActor(req);
    const { id } = req.params as { id: string };
    const body = parseOrThrow(ReviewRequestCreateSchema, req.body);
    const review = await withUserTx(actor, async (tx) => {
      const draft = await loadDraftRow(tx, id);
      const cur = await loadRevision(tx, draft.current_revision_id as string);
      if (!cur) throw notFound();
      const report = await buildPreflight(tx, draft, cur);
      if (report?.blocking) throw new ApiError(422, 'precondition_failed', '形式検査にエラーがあります。修正してからレビューを依頼してください', { details: { issues: report.issues.filter((i) => i.severity === 'error') } });
      const reviewer = await tx.query<{ ok: boolean }>(`SELECT EXISTS (SELECT 1 FROM public.matter_members mm JOIN public.memberships ms ON ms.org_id = $3 AND ms.user_id = mm.user_id AND ms.role = 'lawyer' JOIN public.lawyers l ON l.org_id = $3 AND l.user_id = mm.user_id AND l.active WHERE mm.matter_id = $1 AND mm.user_id = $2) AS ok`, [draft.matter_id, body.reviewerId, actor.orgId]);
      if (!reviewer.rows[0]?.ok) throw validationFailed([{ field: 'reviewerId', code: 'invalid', message: '案件に割り当てられた弁護士を選んでください' }]);
      if (body.reviewerId === cur.createdBy) throw validationFailed([{ field: 'reviewerId', code: 'self_approval', message: '最終編集者本人は承認できません。別の弁護士を選んでください' }]);
      const pdf = await tx.query<{ sha256: string }>(`SELECT sha256 FROM public.draft_outputs WHERE revision_id = $1 AND format = 'pdf' AND status = 'ready' ORDER BY created_at DESC LIMIT 1`, [cur.id]);
      const docx = await tx.query<{ sha256: string }>(`SELECT sha256 FROM public.draft_outputs WHERE revision_id = $1 AND format = 'docx' AND status = 'ready' ORDER BY created_at DESC LIMIT 1`, [cur.id]);
      if (!pdf.rows[0]) throw new ApiError(422, 'precondition_failed', '最終 PDF がまだ生成されていません。プレビューを更新してください');
      await tx.query(`UPDATE public.reviews SET status = 'withdrawn' WHERE status = 'pending' AND revision_id IN (SELECT id FROM public.draft_revisions WHERE draft_id = $1)`, [id]);
      const r = await tx.query<Row>(
        `INSERT INTO public.reviews (org_id, revision_id, target_hash, target_output_pdf_sha256, target_output_docx_sha256, reviewer_id, requested_by, status) VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending') RETURNING *`,
        [draft.org_id, cur.id, cur.hash, pdf.rows[0].sha256, docx.rows[0]?.sha256 ?? null, body.reviewerId, actor.userId],
      );
      await tx.query(`UPDATE public.drafts SET status = 'in_review' WHERE id = $1 AND status IN ('draft','ready_for_review','changes_requested')`, [id]);
      if (body.note) await tx.query('INSERT INTO public.review_comments (org_id, review_id, body_raw, created_by) VALUES ($1, $2, $3, $4)', [draft.org_id, r.rows[0]!.id, body.note, actor.userId]);
      await audit(tx, actor, { action: 'review.requested', targetType: 'review', targetId: r.rows[0]!.id as string, targetHash: cur.hash, matterId: draft.matter_id as string, details: { reviewerId: body.reviewerId } });
      const u = await tx.query<{ display_name_raw: string }>('SELECT display_name_raw FROM public.app_users WHERE id = $1', [body.reviewerId]);
      const row = r.rows[0]!;
      return { id: row.id, revisionId: row.revision_id, draftId: id, targetHash: row.target_hash, targetOutputPdfSha256: row.target_output_pdf_sha256, targetOutputDocxSha256: row.target_output_docx_sha256, reviewerId: row.reviewer_id, reviewerName: u.rows[0]?.display_name_raw ?? null, requestedBy: row.requested_by, requestedByName: null, status: row.status, decisionReason: null, decidedAt: null, createdAt: row.created_at, version: row.version };
    });
    return ok(req, reply, review, {}, 201);
  });

  // ---------- 外部編集版（Word で編集した DOCX の再取込 = 新しい外部編集版。AST へ自動双方向同期しない） ----------
  app.post('/api/drafts/:id/external-edit', async (req, reply) => {
    const actor = requireActor(req);
    const { id } = req.params as { id: string };
    const part = await req.file();
    if (!part) throw validationFailed([{ field: 'file', code: 'required', message: 'DOCX ファイルを添付してください' }]);
    const bytes = await part.toBuffer();
    const detail = await withUserTx(actor, async (tx) => {
      const draft = await loadDraftRow(tx, id);
      if ((draft.status as string) === 'archived') throw conflict('アーカイブ済みです');
      await assertLeaseOrFree(tx, actor, id);
      const cur = await loadRevision(tx, draft.current_revision_id as string);
      if (!cur) throw notFound();
      const stored = await storeUploadedFile(tx, actor, { bytes, originalName: part.filename, mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', scope: 'matter', matterId: draft.matter_id as string, confidential: true });
      const rev = await insertRevision(tx, actor, draft, cur.templateVersionId, cur.snapshot, cur.ast, cur.id, 'external_edit', stored.fileVersionId);
      await setCurrentRevision(tx, actor, draft, rev, draft.version as number, 'draft.external_edit_added');
      await enqueueJob(tx, actor, { type: 'external_edit_ingest', matterId: draft.matter_id as string, scopeKey: `draft:${id}`, payload: { draftId: id, revisionId: rev.id, fileId: stored.fileId, fileVersionId: stored.fileVersionId } });
      return loadDraftDetail(tx, actor, id);
    });
    return ok(req, reply, detail, {}, 201);
  });

  app.post('/api/drafts/:id/archive', async (req, reply) => {
    const actor = requireActor(req);
    const { id } = req.params as { id: string };
    const body = parseOrThrow(z.object({ expectedVersion: z.number().int() }), req.body);
    const detail = await withUserTx(actor, async (tx) => {
      const draft = await loadDraftRow(tx, id);
      if ((draft.version as number) !== body.expectedVersion) throw versionConflict(draft.version as number);
      if (!canTransitionDraft(draft.status as 'draft', 'archived')) throw conflict('この状態ではアーカイブできません');
      await tx.query(`UPDATE public.drafts SET status = 'archived' WHERE id = $1 AND version = $2`, [id, body.expectedVersion]);
      await audit(tx, actor, { action: 'draft.archived', targetType: 'draft', targetId: id, matterId: draft.matter_id as string });
      return loadDraftDetail(tx, actor, id);
    });
    return ok(req, reply, detail);
  });

  // ---------- 文書一覧 / 出力 ----------
  const listHandler = async (actor: Actor, q: z.infer<typeof DraftListQuerySchema>, matterId?: string) => {
    const cur = decodeCursor<{ u: string; id: string }>(q.cursor);
    return withUserTx(actor, async (tx) => {
      const params: unknown[] = [actor.orgId, q.limit + 1];
      let where = 'd.org_id = $1';
      const mid = matterId ?? q.matterId;
      if (mid) { params.push(mid); where += ` AND d.matter_id = $${params.length}`; }
      if (q.kind) { params.push(q.kind); where += ` AND d.kind = $${params.length}`; }
      if (q.status) { params.push(q.status); where += ` AND d.status = $${params.length}`; }
      if (q.mine) { params.push(actor.userId); where += ` AND d.created_by = $${params.length}`; }
      if (q.q) { params.push(`%${q.q.replace(/[%_\\]/g, (ch) => '\\' + ch)}%`); where += ` AND (d.title_raw LIKE $${params.length} OR m.title_raw LIKE $${params.length})`; }
      if (cur) { params.push(cur.u, cur.id); where += ` AND (d.updated_at, d.id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`; }
      const r = await tx.query<Row>(`${DRAFT_SELECT} WHERE ${where} ORDER BY d.updated_at DESC, d.id DESC LIMIT $2`, params);
      const page = r.rows.slice(0, q.limit);
      const last = page[page.length - 1];
      return { items: page.map(draftOut), nextCursor: r.rows.length > q.limit && last ? encodeCursor({ u: last.updated_at as string, id: last.id as string }) : null };
    });
  };
  app.get('/api/documents', async (req, reply) => {
    const actor = requireActor(req);
    const q = parseOrThrow(DraftListQuerySchema, req.query);
    const r = await listHandler(actor, q);
    return ok(req, reply, r.items, { nextCursor: r.nextCursor });
  });
  app.get('/api/matters/:id/documents', async (req, reply) => {
    const actor = requireActor(req);
    const { id } = req.params as { id: string };
    const q = parseOrThrow(DraftListQuerySchema, req.query);
    const r = await listHandler(actor, q, id);
    return ok(req, reply, r.items, { nextCursor: r.nextCursor });
  });

  app.get('/api/documents/:id/output', async (req, reply) => {
    const actor = requireActor(req);
    const { id } = req.params as { id: string };
    const data = await withUserTx(actor, async (tx) => {
      const draft = await loadDraftRow(tx, id);
      const approved = draft.approved_revision_id ? await loadRevision(tx, draft.approved_revision_id as string) : null;
      const finals = approved ? await tx.query<Row>(`SELECT * FROM public.draft_outputs WHERE revision_id = $1 AND mode = 'final' AND status = 'ready' ORDER BY created_at DESC`, [approved.id]) : { rows: [] as Row[] };
      const drafts = await tx.query<Row>(`SELECT o.* FROM public.draft_outputs o JOIN public.draft_revisions r ON r.id = o.revision_id WHERE r.draft_id = $1 AND o.mode = 'draft' AND o.status = 'ready' ORDER BY o.created_at DESC LIMIT 10`, [id]);
      const dispatches = await tx.query<Row>(`SELECT dr.*, u1.display_name_raw AS recorded_by_name, u2.display_name_raw AS verified_by_name FROM public.dispatch_records dr LEFT JOIN public.app_users u1 ON u1.id = dr.recorded_by LEFT JOIN public.app_users u2 ON u2.id = dr.verified_by WHERE dr.output_id IN (SELECT o.id FROM public.draft_outputs o JOIN public.draft_revisions r ON r.id = o.revision_id WHERE r.draft_id = $1) ORDER BY dr.sent_at DESC`, [id]);
      const approver = approved ? await tx.query<{ display_name_raw: string; decided_at: string }>(`SELECT u.display_name_raw, rv.decided_at FROM public.reviews rv JOIN public.app_users u ON u.id = rv.reviewer_id WHERE rv.revision_id = $1 AND rv.status = 'approved' ORDER BY rv.decided_at DESC LIMIT 1`, [approved.id]) : null;
      return {
        draft: draftOut(draft),
        approvedRevision: approved,
        approver: approver?.rows[0] ? { name: approver.rows[0].display_name_raw, decidedAt: approver.rows[0].decided_at } : null,
        outputs: finals.rows.map(outputOut),
        draftOutputs: drafts.rows.map(outputOut),
        dispatches: dispatches.rows.map((d) => ({ ...d, id: d.id, status: d.status, recordedByName: d.recorded_by_name ?? null, verifiedByName: d.verified_by_name ?? null, sentAt: d.sent_at, method: d.method, recipientSnapshot: d.recipient_snapshot, receiptRaw: d.receipt_raw, outputId: d.output_id, packetId: d.packet_id, matterId: d.matter_id, version: d.version, createdAt: d.created_at, verifiedAt: d.verified_at, verifiedBy: d.verified_by, recordedBy: d.recorded_by, receivedDocumentsRaw: d.received_documents_raw, receiptFileId: d.receipt_file_id, outputLabel: null })),
      };
    });
    return ok(req, reply, data);
  });

  // ---------- ダウンロード（毎回 ACL / no-store。final は承認済み revision かつ hash 一致のみ） ----------
  app.get('/api/outputs/:id/download', async (req, reply) => {
    const actor = requireActor(req);
    const { id } = req.params as { id: string };
    const q = parseOrThrow(z.object({ mode: z.enum(['draft', 'final']).default('draft') }), req.query);
    const { bytes, filename, mime } = await withUserTx(actor, async (tx) => {
      const o = await tx.query<Row>(`SELECT o.*, r.draft_id, r.hash, d.approved_revision_id, d.status AS draft_status, d.title_raw, d.matter_id, f.storage_key FROM public.draft_outputs o JOIN public.draft_revisions r ON r.id = o.revision_id JOIN public.drafts d ON d.id = r.draft_id JOIN public.files f ON f.id = o.file_id WHERE o.id = $1`, [id]);
      const out = o.rows[0];
      if (!out) throw notFound();
      if (out.status !== 'ready') throw conflict('この出力は利用できません');
      if (q.mode === 'final') {
        if (out.mode !== 'final') throw new ApiError(409, 'precondition_failed', '正式版の出力ではありません。承認後に正式版を生成してください');
        if (out.draft_status !== 'approved' || out.approved_revision_id !== out.revision_id) throw new ApiError(409, 'precondition_failed', '承認済みの版と一致しません（承認が失効している可能性があります）');
        const rv = await tx.query<{ target_hash: string; target_output_pdf_sha256: string | null }>(`SELECT target_hash, target_output_pdf_sha256 FROM public.reviews WHERE revision_id = $1 AND status = 'approved' ORDER BY decided_at DESC LIMIT 1`, [out.revision_id]);
        if (!rv.rows[0] || rv.rows[0].target_hash !== out.hash) throw new ApiError(409, 'hash_stale', '承認対象 hash と一致しません。再承認が必要です');
      } else if (out.mode !== 'draft') {
        throw new ApiError(409, 'precondition_failed', 'mode=final を指定してください');
      }
      const bytes = await blobStore.get(out.storage_key as string);
      await audit(tx, actor, { action: q.mode === 'final' ? 'output.downloaded_final' : 'output.downloaded_draft', targetType: 'draft_output', targetId: id, targetHash: out.sha256 as string, matterId: out.matter_id as string, details: { note: 'ダウンロードは送付/提出済みを意味しない' } });
      const ext = out.format as string;
      const base = (out.title_raw as string).replace(/[\\/:*?"<>|\r\n]/g, '_').slice(0, 60);
      return { bytes, filename: `${q.mode === 'draft' ? '【草案】' : ''}${base}.${ext}`, mime: ext === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };
    });
    reply.header('Content-Type', mime);
    reply.header('Content-Disposition', `attachment; filename="${encodeURIComponent(filename).replace(/['()]/g, escape)}"; filename*=UTF-8''${encodeURIComponent(filename)}`);
    reply.header('Cache-Control', 'no-store');
    return reply.send(bytes);
  });

  // 内部用: revision 単体取得（レビュー差分）
  app.get('/api/draft-revisions/:id', async (req, reply) => {
    const actor = requireActor(req);
    const { id } = req.params as { id: string };
    const r = await withUserTx(actor, async (tx) => {
      const rev = await loadRevision(tx, id);
      if (!rev) throw notFound();
      return rev;
    });
    return ok(req, reply, r);
  });
  void DocumentASTSchema;
  void revisionOut;
}
