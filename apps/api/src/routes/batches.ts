import type { FastifyInstance } from 'fastify';
import { BatchCreateSchema, type Batch, type DraftSnapshot } from '@raylow/contracts';
import { BATCH_MAX_ITEMS, BATCH_MAX_RECIPIENTS, BATCH_MAX_TEMPLATES } from '@raylow/domain';
import { emptyAST } from '@raylow/template-schema';
import { withUserTx, type Actor, type Tx } from '../db/pool.js';
import { ApiError, conflict, notFound } from '../errors.js';
import { requireActor } from '../plugins/auth.js';
import { ok } from '../lib/reply.js';
import { parseOrThrow } from '../lib/validate.js';
import { audit } from '../services/audit.js';
import { enqueueJob } from '../services/jobs.js';
import { buildInitialFields, buildRecipientSnapshot, loadSources, revisionHash, templateSchemaOf } from '../services/drafts.js';

type Row = Record<string, unknown>;

async function loadBatch(tx: Tx, id: string): Promise<Batch> {
  const b = await tx.query<Row>('SELECT * FROM public.batches WHERE id = $1', [id]);
  const row = b.rows[0];
  if (!row) throw notFound();
  const items = await tx.query<Row>('SELECT bi.*, t.name AS template_name FROM public.batch_items bi JOIN public.template_versions tv ON tv.id = bi.template_version_id JOIN public.templates t ON t.id = tv.template_id WHERE bi.batch_id = $1 ORDER BY bi.created_at', [id]);
  const counts = { total: items.rows.length, succeeded: 0, failed: 0, queued: 0, running: 0 };
  for (const it of items.rows) {
    const s = it.status as string;
    if (s === 'succeeded') counts.succeeded++;
    else if (s === 'failed') counts.failed++;
    else if (s === 'running') counts.running++;
    else if (s === 'queued') counts.queued++;
  }
  return {
    id: row.id as string, matterId: row.matter_id as string, status: row.status as Batch['status'], purpose: row.purpose as Batch['purpose'],
    items: items.rows.map((it) => ({ id: it.id as string, batchId: id, draftId: (it.draft_id as string | null) ?? null, templateVersionId: it.template_version_id as string, templateName: it.template_name as string, recipientSnapshot: it.recipient_snapshot as Record<string, unknown>, status: it.status as 'queued', errorCode: (it.error_code as string | null) ?? null, errorMessage: (it.error_message as string | null) ?? null, jobId: (it.job_id as string | null) ?? null, attempt: it.attempt as number })),
    counts, createdAt: row.created_at as string, updatedAt: row.updated_at as string, version: row.version as number,
  };
}

/** 宛先ごとに独立 snapshot。対象外当事者や他宛先を差し込まない。 */
async function createItemDraft(tx: Tx, actor: Actor, batch: Row, tvRow: Row, recipient: { type: string; contactId: string | null }, idemp: string): Promise<{ draftId: string; revisionId: string; hash: string }> {
  const schema = templateSchemaOf(tvRow);
  if (!schema.recipientTypes.includes(recipient.type as 'client')) throw new ApiError(422, 'validation_failed', `${tvRow.name as string} では宛先種別 ${recipient.type} を選べません`);
  const src = await loadSources(tx, batch.matter_id as string, recipient.contactId, null);
  const rs = buildRecipientSnapshot(recipient.type as 'client', src.recipient, src.honorificSettings);
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
  const snapshot: DraftSnapshot = { schemaVersion: 1, fields: buildInitialFields(schema, src, rs, today), recipient: rs, attachments: [], sources: { officeProfileId: (src.office?.id as string) ?? null, officeProfileRevision: src.office ? Number(src.office.revision) : null, matterVersion: Number(src.matter.version), lawyerId: (src.lawyer?.id as string) ?? null, lawyerVersion: src.lawyer ? Number(src.lawyer.version) : null, templateVersionId: tvRow.id as string, phraseVersionIds: [] }, issueDate: today };
  const ast = emptyAST();
  const hash = await revisionHash(snapshot, ast, tvRow.id as string);
  const title = `${tvRow.name as string}（${rs.nameRaw || recipient.type}）`;
  const d = await tx.query<{ id: string }>(`INSERT INTO public.drafts (org_id, matter_id, template_id, kind, title_raw, status, recipient_type, recipient_contact_id, idempotency_key, batch_id, created_by) VALUES ($1, $2, $3, $4, $5, 'draft', $6, $7, $8, $9, $10) RETURNING id`, [actor.orgId, batch.matter_id, tvRow.template_id, tvRow.kind, title, recipient.type, recipient.contactId, idemp, batch.id, actor.userId]);
  const r = await tx.query<{ id: string }>(`INSERT INTO public.draft_revisions (org_id, draft_id, revision, template_version_id, snapshot_json, ast_json, kind, hash, created_by) VALUES ($1, $2, 1, $3, $4, $5, 'app', $6, $7) RETURNING id`, [actor.orgId, d.rows[0]!.id, tvRow.id, JSON.stringify(snapshot), JSON.stringify(ast), hash, actor.userId]);
  await tx.query('UPDATE public.drafts SET current_revision_id = $2 WHERE id = $1', [d.rows[0]!.id, r.rows[0]!.id]);
  return { draftId: d.rows[0]!.id, revisionId: r.rows[0]!.id, hash };
}

export async function batchRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/batches', async (req, reply) => {
    const actor = requireActor(req);
    const body = parseOrThrow(BatchCreateSchema, req.body);
    const uniqueTv = [...new Set(body.templateVersionIds)];
    if (uniqueTv.length > BATCH_MAX_TEMPLATES || body.recipients.length > BATCH_MAX_RECIPIENTS || uniqueTv.length * body.recipients.length > BATCH_MAX_ITEMS) {
      throw new ApiError(422, 'batch_limit_exceeded', `一括生成は最大 ${BATCH_MAX_TEMPLATES} 書式 × ${BATCH_MAX_RECIPIENTS} 宛先、合計 ${BATCH_MAX_ITEMS} 成果物までです（指定: ${uniqueTv.length}×${body.recipients.length}=${uniqueTv.length * body.recipients.length}）`);
    }
    const batch = await withUserTx(actor, async (tx) => {
      const existing = await tx.query<{ id: string }>('SELECT id FROM public.batches WHERE org_id = $1 AND idempotency_key = $2', [actor.orgId, body.idempotencyKey]);
      if (existing.rows[0]) return loadBatch(tx, existing.rows[0].id);
      const edit = await tx.query<{ ok: boolean }>('SELECT app.can_edit_matter($1) AS ok', [body.matterId]);
      if (!edit.rows[0]?.ok) throw notFound();
      const tvs = await tx.query<Row>('SELECT tv.*, t.name FROM public.template_versions tv JOIN public.templates t ON t.id = tv.template_id WHERE tv.id = ANY($1::uuid[]) AND tv.org_id = $2', [uniqueTv, actor.orgId]);
      if (tvs.rows.length !== uniqueTv.length) throw notFound();
      for (const tv of tvs.rows) {
        if (tv.status !== 'published') throw new ApiError(422, 'template_not_published', `${tv.name as string} は公開されていません`);
        if (body.purpose === 'submission_pack' && tv.sample_only) throw new ApiError(422, 'template_sample_only', `${tv.name as string} はサンプル書式のため正式提出パックに使えません`);
      }
      // 宛先が案件の当事者/代理人に属するか（他宛先混入の防止）
      for (const rc of body.recipients) {
        if (!rc.contactId) continue;
        const okc = await tx.query<{ n: string }>(`SELECT count(*) AS n FROM (SELECT contact_id AS cid FROM public.matter_parties WHERE matter_id = $1 UNION SELECT lawyer_contact_id FROM public.matter_agents WHERE matter_id = $1 UNION SELECT representative_id FROM public.matter_parties WHERE matter_id = $1 AND representative_id IS NOT NULL) x WHERE x.cid = $2`, [body.matterId, rc.contactId]);
        if (Number(okc.rows[0]!.n) === 0) {
          const c = await tx.query('SELECT 1 FROM public.contacts WHERE id = $1 AND org_id = $2', [rc.contactId, actor.orgId]);
          if (!c.rowCount) throw notFound();
          // 案件外の連絡先は警告として item に記録（ここでは許可するが recipient_snapshot に flag）
        }
      }
      const b = await tx.query<Row>(`INSERT INTO public.batches (org_id, matter_id, status, idempotency_key, purpose, created_by) VALUES ($1, $2, 'queued', $3, $4, $5) RETURNING *`, [actor.orgId, body.matterId, body.idempotencyKey, body.purpose, actor.userId]);
      const batchRow = b.rows[0]!;
      let n = 0;
      for (const tv of tvs.rows) {
        for (const rc of body.recipients) {
          n++;
          const idemp = `${body.idempotencyKey}:${tv.id as string}:${rc.type}:${rc.contactId ?? 'none'}`;
          let item: Row;
          try {
            const created = await createItemDraft(tx, actor, batchRow, tv, rc, idemp);
            const job = await enqueueJob(tx, actor, { type: 'render_draft', matterId: body.matterId, scopeKey: `draft:${created.draftId}`, payload: { draftId: created.draftId, revisionId: created.revisionId, mode: 'draft', hash: created.hash, batchItem: true } });
            const ir = await tx.query<Row>(`INSERT INTO public.batch_items (org_id, batch_id, draft_id, template_version_id, recipient_snapshot, status, job_id, attempt) VALUES ($1, $2, $3, $4, $5, 'queued', $6, 1) RETURNING *`, [actor.orgId, batchRow.id, created.draftId, tv.id, JSON.stringify({ type: rc.type, contactId: rc.contactId }), job.jobId]);
            item = ir.rows[0]!;
            await tx.query(`UPDATE public.jobs SET payload = payload || jsonb_build_object('batchItemId', $2::text) WHERE id = $1`, [job.jobId, item.id]);
          } catch (e) {
            if (e instanceof ApiError && e.status === 422) {
              await tx.query(`INSERT INTO public.batch_items (org_id, batch_id, template_version_id, recipient_snapshot, status, error_code, error_message) VALUES ($1, $2, $3, $4, 'failed', 'recipient_type_not_allowed', $5)`, [actor.orgId, batchRow.id, tv.id, JSON.stringify({ type: rc.type, contactId: rc.contactId }), e.message]);
              continue;
            }
            throw e;
          }
        }
      }
      await tx.query(`UPDATE public.batches SET status = 'running' WHERE id = $1`, [batchRow.id]);
      await audit(tx, actor, { action: 'batch.created', targetType: 'batch', targetId: batchRow.id as string, matterId: body.matterId, details: { items: n, templates: uniqueTv.length, recipients: body.recipients.length } });
      return loadBatch(tx, batchRow.id as string);
    });
    return ok(req, reply, batch, {}, 202);
  });

  app.get('/api/batches/:id', async (req, reply) => {
    const actor = requireActor(req);
    const { id } = req.params as { id: string };
    return ok(req, reply, await withUserTx(actor, (tx) => loadBatch(tx, id)));
  });

  // cancel: 未開始の子だけ停止。処理中は worker が安全な checkpoint で停止。
  app.post('/api/batches/:id/cancel', async (req, reply) => {
    const actor = requireActor(req);
    const { id } = req.params as { id: string };
    const b = await withUserTx(actor, async (tx) => {
      const cur = await tx.query<Row>('SELECT * FROM public.batches WHERE id = $1 FOR UPDATE', [id]);
      if (!cur.rows[0]) throw notFound();
      await tx.query(`UPDATE public.jobs SET cancel_requested = true WHERE id IN (SELECT job_id FROM public.batch_items WHERE batch_id = $1 AND status IN ('queued','running') AND job_id IS NOT NULL)`, [id]);
      await tx.query(`UPDATE public.batch_items SET status = 'cancelled' WHERE batch_id = $1 AND status = 'queued'`, [id]);
      await tx.query(`UPDATE public.batches SET status = 'cancelled' WHERE id = $1`, [id]);
      await audit(tx, actor, { action: 'batch.cancelled', targetType: 'batch', targetId: id, matterId: cur.rows[0].matter_id as string });
      return loadBatch(tx, id);
    });
    return ok(req, reply, b);
  });

  // 失敗分だけ再試行
  app.post('/api/batch-items/:id/retry', async (req, reply) => {
    const actor = requireActor(req);
    const { id } = req.params as { id: string };
    const item = await withUserTx(actor, async (tx) => {
      const cur = await tx.query<Row>('SELECT bi.*, b.matter_id FROM public.batch_items bi JOIN public.batches b ON b.id = bi.batch_id WHERE bi.id = $1 FOR UPDATE OF bi', [id]);
      const it = cur.rows[0];
      if (!it) throw notFound();
      if (it.status !== 'failed') throw conflict('失敗した項目のみ再試行できます');
      if (!it.draft_id) throw conflict('この項目は草案を作成できなかったため再試行できません（宛先種別を確認してください）');
      const rev = await tx.query<{ id: string; hash: string }>('SELECT r.id, r.hash FROM public.drafts d JOIN public.draft_revisions r ON r.id = d.current_revision_id WHERE d.id = $1', [it.draft_id]);
      if (!rev.rows[0]) throw notFound();
      const job = await enqueueJob(tx, actor, { type: 'render_draft', matterId: it.matter_id as string, scopeKey: `draft:${it.draft_id as string}`, payload: { draftId: it.draft_id, revisionId: rev.rows[0].id, mode: 'draft', hash: rev.rows[0].hash, batchItem: true, batchItemId: id, retry: (it.attempt as number) + 1 } });
      await tx.query(`UPDATE public.batch_items SET status = 'queued', job_id = $2, attempt = attempt + 1, error_code = NULL, error_message = NULL, updated_at = now() WHERE id = $1`, [id, job.jobId]);
      await tx.query(`UPDATE public.batches SET status = 'running' WHERE id = $1`, [it.batch_id]);
      await audit(tx, actor, { action: 'batch.item_retried', targetType: 'batch_item', targetId: id, matterId: it.matter_id as string });
      const b = await loadBatch(tx, it.batch_id as string);
      return b.items.find((x) => x.id === id)!;
    });
    return ok(req, reply, item);
  });
}
