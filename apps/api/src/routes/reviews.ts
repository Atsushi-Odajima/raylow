import type { FastifyInstance } from 'fastify';
import { ReviewCommentInputSchema, ReviewDecisionSchema, ReviewListQuerySchema, type Review, type ReviewComment, type ReviewDetail } from '@raylow/contracts';
import { APPROVAL_DENIAL_MESSAGES, checkApproval } from '@raylow/domain';
import { withUserTx, type Actor, type Tx } from '../db/pool.js';
import { ApiError, conflict, notFound, versionConflict } from '../errors.js';
import { requireActor } from '../plugins/auth.js';
import { ok } from '../lib/reply.js';
import { decodeCursor, encodeCursor, parseOrThrow } from '../lib/validate.js';
import { audit } from '../services/audit.js';
import { buildPreflight, draftOut, loadDraftRow, loadRevision, outputOut } from '../services/draftDetail.js';

type Row = Record<string, unknown>;

function reviewOut(r: Row): Review {
  return {
    id: r.id as string, revisionId: r.revision_id as string, draftId: r.draft_id as string, targetHash: r.target_hash as string, targetOutputPdfSha256: (r.target_output_pdf_sha256 as string | null) ?? null, targetOutputDocxSha256: (r.target_output_docx_sha256 as string | null) ?? null,
    reviewerId: (r.reviewer_id as string | null) ?? null, reviewerName: (r.reviewer_name as string | null) ?? null, requestedBy: (r.requested_by as string | null) ?? null, requestedByName: (r.requested_by_name as string | null) ?? null, status: r.status as Review['status'], decisionReason: (r.decision_reason as string | null) ?? null, decidedAt: (r.decided_at as string | null) ?? null, createdAt: r.created_at as string, version: r.version as number,
  };
}
const REVIEW_SELECT = `SELECT rv.*, r.draft_id, u1.display_name_raw AS reviewer_name, u2.display_name_raw AS requested_by_name FROM public.reviews rv JOIN public.draft_revisions r ON r.id = rv.revision_id LEFT JOIN public.app_users u1 ON u1.id = rv.reviewer_id LEFT JOIN public.app_users u2 ON u2.id = rv.requested_by`;

function commentOut(r: Row): ReviewComment {
  return { id: r.id as string, reviewId: r.review_id as string, blockId: (r.block_id as string | null) ?? null, fieldKey: (r.field_key as string | null) ?? null, bodyRaw: r.body_raw as string, createdBy: (r.created_by as string | null) ?? null, createdByName: (r.created_by_name as string | null) ?? null, resolvedAt: (r.resolved_at as string | null) ?? null, createdAt: r.created_at as string };
}

async function loadReviewDetail(tx: Tx, actor: Actor, id: string): Promise<ReviewDetail> {
  const r = await tx.query<Row>(`${REVIEW_SELECT} WHERE rv.id = $1`, [id]);
  const row = r.rows[0];
  if (!row) throw notFound();
  const draft = await loadDraftRow(tx, row.draft_id as string);
  const revision = await loadRevision(tx, row.revision_id as string);
  if (!revision) throw notFound();
  const prevApproved = await tx.query<Row>(`SELECT r2.id FROM public.reviews rv2 JOIN public.draft_revisions r2 ON r2.id = rv2.revision_id WHERE r2.draft_id = $1 AND rv2.status = 'approved' AND r2.id <> $2 ORDER BY rv2.decided_at DESC LIMIT 1`, [draft.id, revision.id]);
  const previousApprovedRevision = prevApproved.rows[0] ? await loadRevision(tx, prevApproved.rows[0].id as string) : null;
  const outputs = await tx.query<Row>(`SELECT * FROM public.draft_outputs WHERE revision_id = $1 AND status = 'ready' ORDER BY created_at DESC`, [revision.id]);
  const comments = await tx.query<Row>('SELECT c.*, u.display_name_raw AS created_by_name FROM public.review_comments c LEFT JOIN public.app_users u ON u.id = c.created_by WHERE c.review_id = $1 ORDER BY c.created_at', [id]);
  const flags = await tx.query<{ assigned: boolean; member: boolean }>('SELECT app.is_assigned_lawyer($1) AS assigned, app.can_access_matter($1) AS member', [draft.matter_id]);
  const current = draft.current_revision_id as string;
  const hashCurrent = current === revision.id && revision.hash === row.target_hash;
  const check = checkApproval({ actorUserId: actor.userId, actorRole: actor.role, actorIsMatterMember: flags.rows[0]!.member, actorIsBarrier: false, actorIsAssignedLawyer: flags.rows[0]!.assigned, lastEditorUserId: revision.createdBy ?? '', targetHash: row.target_hash as string, currentHash: hashCurrent ? (row.target_hash as string) : 'stale', draftStatus: draft.status as string });
  const preflight = await buildPreflight(tx, draft, revision);
  return { review: reviewOut(row), draft: draftOut(draft), revision, previousApprovedRevision, outputs: outputs.rows.map(outputOut), preflight, comments: comments.rows.map(commentOut), hashCurrent, canDecide: row.status === 'pending' && check.ok, denialReason: check.ok ? null : APPROVAL_DENIAL_MESSAGES[check.reason] };
}

export async function reviewRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/reviews', async (req, reply) => {
    const actor = requireActor(req);
    const q = parseOrThrow(ReviewListQuerySchema, req.query);
    const cur = decodeCursor<{ c: string; id: string }>(q.cursor);
    const rows = await withUserTx(actor, async (tx) => {
      const params: unknown[] = [actor.orgId, q.limit + 1];
      let where = 'rv.org_id = $1';
      if (q.status) { params.push(q.status); where += ` AND rv.status = $${params.length}`; }
      if (q.mine) { params.push(actor.userId); where += ` AND (rv.reviewer_id = $${params.length} OR rv.requested_by = $${params.length})`; }
      if (cur) { params.push(cur.c, cur.id); where += ` AND (rv.created_at, rv.id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`; }
      const r = await tx.query<Row>(`${REVIEW_SELECT} WHERE ${where} ORDER BY rv.created_at DESC, rv.id DESC LIMIT $2`, params);
      return r.rows;
    });
    const page = rows.slice(0, q.limit);
    const last = page[page.length - 1];
    return ok(req, reply, page.map(reviewOut), { nextCursor: rows.length > q.limit && last ? encodeCursor({ c: last.created_at as string, id: last.id as string }) : null });
  });

  app.get('/api/reviews/:id', async (req, reply) => {
    const actor = requireActor(req);
    const { id } = req.params as { id: string };
    return ok(req, reply, await withUserTx(actor, (tx) => loadReviewDetail(tx, actor, id)));
  });

  // 最終承認: 割当 lawyer のみ、最終編集者以外、hash 再検証、transaction 内。古い版承認は 409。
  app.post('/api/reviews/:id/decision', { config: { auth: { roles: ['lawyer', 'admin'] } } }, async (req, reply) => {
    const actor = requireActor(req);
    const { id } = req.params as { id: string };
    const body = parseOrThrow(ReviewDecisionSchema, req.body);
    const detail = await withUserTx(actor, async (tx) => {
      const r = await tx.query<Row>(`${REVIEW_SELECT} WHERE rv.id = $1 FOR UPDATE OF rv`, [id]);
      const row = r.rows[0];
      if (!row) throw notFound();
      if ((row.version as number) !== body.expectedVersion) throw versionConflict(row.version as number);
      if (row.status !== 'pending') throw conflict('このレビューは既に決定済みです');
      const draft = await tx.query<Row>('SELECT * FROM public.drafts WHERE id = $1 FOR UPDATE', [row.draft_id]);
      const d = draft.rows[0];
      if (!d) throw notFound();
      const revision = await loadRevision(tx, row.revision_id as string);
      if (!revision) throw notFound();
      const flags = await tx.query<{ assigned: boolean; member: boolean }>('SELECT app.is_assigned_lawyer($1) AS assigned, app.can_access_matter($1) AS member', [d.matter_id]);
      const currentHash = d.current_revision_id === revision.id ? revision.hash : 'stale';
      const check = checkApproval({ actorUserId: actor.userId, actorRole: actor.role, actorIsMatterMember: flags.rows[0]!.member, actorIsBarrier: false, actorIsAssignedLawyer: flags.rows[0]!.assigned, lastEditorUserId: revision.createdBy ?? '', targetHash: body.targetHash, currentHash, draftStatus: d.status as string });
      if (!check.ok) throw new ApiError(check.httpStatus, check.reason === 'hash_stale' ? 'hash_stale' : 'approval_denied', APPROVAL_DENIAL_MESSAGES[check.reason]);
      if (body.targetHash !== row.target_hash) throw new ApiError(409, 'hash_stale', 'レビュー対象の hash が一致しません');
      if (body.decision === 'approved') {
        // 承認対象 = AST/入力 snapshot/書式 hash/出力 DOCX/PDF hash/添付 manifest/rendererProfile の組を再検証
        const pdf = await tx.query<{ sha256: string }>(`SELECT sha256 FROM public.draft_outputs WHERE revision_id = $1 AND format = 'pdf' AND mode = 'draft' AND status = 'ready' ORDER BY created_at DESC LIMIT 1`, [revision.id]);
        if (!pdf.rows[0] || pdf.rows[0].sha256 !== row.target_output_pdf_sha256) throw new ApiError(409, 'hash_stale', '最終 PDF の hash が依頼時と一致しません。再生成してください');
        if (body.targetOutputPdfSha256 && body.targetOutputPdfSha256 !== pdf.rows[0].sha256) throw new ApiError(409, 'hash_stale', 'PDF hash が一致しません');
        const tv = await tx.query<{ status: string; docx_sha256: string }>('SELECT status, docx_sha256 FROM public.template_versions WHERE id = $1', [revision.templateVersionId]);
        if (tv.rows[0]?.status !== 'published') throw conflict('書式版が公開状態ではありません');
        const report = await buildPreflight(tx, d, revision);
        if (report?.blocking) throw new ApiError(422, 'precondition_failed', '形式検査にエラーがあります', { details: { issues: report.issues.filter((i) => i.severity === 'error') } });
        const confirmed = new Set(body.confirmations.map((c) => c.code));
        const missing = (report?.confirmationsRequired ?? []).filter((c) => !confirmed.has(c));
        if (missing.length) throw new ApiError(422, 'precondition_failed', `要確認項目に理由付きの確認が必要です: ${missing.join(', ')}`, { details: { missing } });
        // 受任通知: 受任確認済みが正式版の条件
        if (d.kind === 'T01_engagement_notice') {
          const m = await tx.query<{ acceptance_status: string }>('SELECT acceptance_status FROM public.matters WHERE id = $1', [d.matter_id]);
          if (m.rows[0]?.acceptance_status !== 'confirmed') throw new ApiError(422, 'precondition_failed', '受任通知の正式版には案件の受任確認（confirmed）が必要です');
        }
        await tx.query(`UPDATE public.reviews SET status = 'approved', decision_reason = $2, decided_at = now(), reviewer_id = $3 WHERE id = $1`, [id, body.reason ?? null, actor.userId]);
        const up = await tx.query<{ version: number }>(`UPDATE public.drafts SET status = 'approved', approved_revision_id = $2 WHERE id = $1 AND current_revision_id = $2 RETURNING version`, [d.id, revision.id]);
        if (!up.rows[0]) throw new ApiError(409, 'hash_stale', '承認中に草案が更新されました');
        await audit(tx, actor, { action: 'review.approved', targetType: 'draft', targetId: d.id as string, targetVersion: up.rows[0].version, targetHash: revision.hash, matterId: d.matter_id as string, details: { reviewId: id, pdfSha256: pdf.rows[0].sha256, templateDocxSha256: tv.rows[0].docx_sha256, confirmations: body.confirmations } });
      } else {
        if (!body.reason) throw new ApiError(422, 'validation_failed', '差戻しには理由が必要です', { fieldErrors: [{ field: 'reason', code: 'required', message: '理由を入力してください' }] });
        await tx.query(`UPDATE public.reviews SET status = 'changes_requested', decision_reason = $2, decided_at = now(), reviewer_id = $3 WHERE id = $1`, [id, body.reason, actor.userId]);
        await tx.query(`UPDATE public.drafts SET status = 'changes_requested' WHERE id = $1`, [d.id]);
        await audit(tx, actor, { action: 'review.changes_requested', targetType: 'draft', targetId: d.id as string, targetHash: revision.hash, matterId: d.matter_id as string, details: { reviewId: id } });
      }
      return loadReviewDetail(tx, actor, id);
    });
    return ok(req, reply, detail);
  });

  app.post('/api/reviews/:id/comments', async (req, reply) => {
    const actor = requireActor(req);
    const { id } = req.params as { id: string };
    const body = parseOrThrow(ReviewCommentInputSchema, req.body);
    const c = await withUserTx(actor, async (tx) => {
      const rv = await tx.query<{ org_id: string }>('SELECT org_id FROM public.reviews WHERE id = $1', [id]);
      if (!rv.rows[0]) throw notFound();
      const r = await tx.query<Row>('INSERT INTO public.review_comments (org_id, review_id, block_id, field_key, body_raw, created_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *', [rv.rows[0].org_id, id, body.blockId ?? null, body.fieldKey ?? null, body.bodyRaw, actor.userId]);
      await audit(tx, actor, { action: 'review.comment_added', targetType: 'review', targetId: id });
      const u = await tx.query<{ display_name_raw: string }>('SELECT display_name_raw FROM public.app_users WHERE id = $1', [actor.userId]);
      return commentOut({ ...r.rows[0]!, created_by_name: u.rows[0]?.display_name_raw ?? null });
    });
    return ok(req, reply, c, {}, 201);
  });
  app.post('/api/review-comments/:id/resolve', async (req, reply) => {
    const actor = requireActor(req);
    const { id } = req.params as { id: string };
    const c = await withUserTx(actor, async (tx) => {
      const r = await tx.query<Row>('UPDATE public.review_comments SET resolved_at = now() WHERE id = $1 RETURNING *', [id]);
      if (!r.rows[0]) throw notFound();
      return commentOut(r.rows[0]);
    });
    return ok(req, reply, c);
  });
}
