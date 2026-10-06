import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { PhraseApproveSchema, PhraseInputSchema, PhraseVersionInputSchema, TemplateImportFieldsSchema, TemplateListQuerySchema, TemplatePublishSchema, TemplateRetireSchema, TemplateSchemaUpdateSchema, TemplateTestRequestSchema, type Phrase, type TemplateSummary, type TemplateVersion } from '@raylow/contracts';
import { canTransitionTemplateVersion } from '@raylow/domain';
import { parseTemplateFieldSchema, validateTemplateSchema, type DiscoveredTag } from '@raylow/template-schema';
import { withUserTx, type Actor, type Tx } from '../db/pool.js';
import { ApiError, conflict, forbidden, notFound, validationFailed, versionConflict } from '../errors.js';
import { requireActor } from '../plugins/auth.js';
import { ok } from '../lib/reply.js';
import { parseOrThrow } from '../lib/validate.js';
import { audit } from '../services/audit.js';
import { enqueueJob } from '../services/jobs.js';
import { detectMagic, storeUploadedFile } from '../services/files.js';
import { blobStore } from '../services/blobs.js';

type Row = Record<string, unknown>;

export function versionOut(r: Row): TemplateVersion {
  const parsed = parseTemplateFieldSchema(r.field_schema);
  return {
    id: r.id as string, templateId: r.template_id as string, orgId: r.org_id as string, revision: r.revision as number, docxFileId: r.docx_file_id as string, docxSha256: r.docx_sha256 as string, fieldSchema: parsed.schema, kind: r.kind as string, scope: r.scope as string, applicability: (r.applicability as Record<string, unknown>) ?? {},
    sourceUrl: (r.source_url as string | null) ?? null, checkedAt: (r.checked_at as string | null) ?? null, licenseNote: (r.license_note as string | null) ?? null, status: r.status as TemplateVersion['status'], sampleOnly: r.sample_only as boolean, approvedBy: (r.approved_by as string | null) ?? null, approvedAt: (r.approved_at as string | null) ?? null,
    rendererProfileId: (r.renderer_profile_id as string | null) ?? null, inspectionReport: (r.inspection_report as TemplateVersion['inspectionReport']) ?? null, tagMap: (r.tag_map as Record<string, string>) ?? {}, provenance: (r.provenance as Record<string, unknown>) ?? {}, createdAt: r.created_at as string, version: r.version as number,
  };
}

async function summaryRows(tx: Tx, orgId: string, where: string, params: unknown[]): Promise<TemplateSummary[]> {
  const r = await tx.query<Row>(
    `SELECT t.*, av.id AS av_id, av.revision AS av_revision, av.status AS av_status, av.sample_only AS av_sample_only, av.scope AS av_scope, av.approved_by AS av_approved_by, av.approved_at AS av_approved_at,
            (SELECT status FROM public.template_versions lv WHERE lv.template_id = t.id ORDER BY lv.revision DESC LIMIT 1) AS latest_status
     FROM public.templates t LEFT JOIN public.template_versions av ON av.id = t.active_version_id WHERE t.org_id = $1 ${where} ORDER BY t.kind, t.name`,
    [orgId, ...params],
  );
  return r.rows.map((x) => ({
    id: x.id as string, orgId: x.org_id as string, name: x.name as string, kind: x.kind as string, activeVersionId: (x.active_version_id as string | null) ?? null,
    activeVersion: x.av_id ? { id: x.av_id as string, revision: x.av_revision as number, status: x.av_status as 'published', sampleOnly: x.av_sample_only as boolean, scope: x.av_scope as string, approvedBy: (x.av_approved_by as string | null) ?? null, approvedAt: (x.av_approved_at as string | null) ?? null } : null,
    latestVersionStatus: (x.latest_status as TemplateSummary['latestVersionStatus']) ?? null, updatedAt: x.updated_at as string, version: x.version as number,
  }));
}

async function loadVersion(tx: Tx, id: string): Promise<Row> {
  const r = await tx.query<Row>('SELECT * FROM public.template_versions WHERE id = $1', [id]);
  if (!r.rows[0]) throw notFound();
  return r.rows[0];
}

function phraseOut(r: Row, versions: Row[]): Phrase {
  const vo = (v: Row) => ({ id: v.id as string, phraseId: v.phrase_id as string, revision: v.revision as number, bodyRaw: v.body_raw as string, status: v.status as 'draft', approvedBy: (v.approved_by as string | null) ?? null, approvedAt: (v.approved_at as string | null) ?? null, createdAt: v.created_at as string });
  const cur = versions.find((v) => v.id === r.current_version_id);
  return { id: r.id as string, orgId: r.org_id as string, title: r.title as string, category: r.category as string, templateKind: (r.template_kind as string | null) ?? null, currentVersion: cur ? vo(cur) : null, versions: versions.map(vo), updatedAt: r.updated_at as string, version: r.version as number };
}
async function loadPhrase(tx: Tx, id: string): Promise<Phrase> {
  const r = await tx.query<Row>('SELECT * FROM public.phrase_libraries WHERE id = $1', [id]);
  if (!r.rows[0]) throw notFound();
  const v = await tx.query<Row>('SELECT * FROM public.phrase_versions WHERE phrase_id = $1 ORDER BY revision DESC', [id]);
  return phraseOut(r.rows[0], v.rows);
}

export async function createTemplateVersion(tx: Tx, actor: Actor, input: { templateId: string | null; name: string; kind: string; scope: string; docxBytes: Buffer; originalName: string; fieldSchema: unknown; provenance: Record<string, unknown>; sourceUrl?: string | null; checkedAt?: string | null; licenseNote?: string | null; sampleOnly: boolean; rendererProfileId?: string | null }): Promise<{ templateId: string; versionId: string; fileId: string }> {
  let templateId = input.templateId;
  if (!templateId) {
    const t = await tx.query<{ id: string }>('INSERT INTO public.templates (org_id, name, kind, created_by) VALUES ($1, $2, $3, $4) RETURNING id', [actor.orgId, input.name, input.kind, actor.userId]);
    templateId = t.rows[0]!.id;
  }
  const stored = await storeUploadedFile(tx, actor, { bytes: input.docxBytes, originalName: input.originalName, mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', scope: 'template', matterId: null, confidential: false });
  const rev = await tx.query<{ n: number }>('SELECT COALESCE(max(revision), 0) + 1 AS n FROM public.template_versions WHERE template_id = $1', [templateId]);
  const v = await tx.query<{ id: string }>(
    `INSERT INTO public.template_versions (org_id, template_id, revision, docx_file_id, docx_sha256, field_schema, kind, scope, source_url, checked_at, license_note, status, sample_only, provenance, renderer_profile_id, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'draft', $12, $13, $14, $15) RETURNING id`,
    [actor.orgId, templateId, rev.rows[0]!.n, stored.fileId, stored.sha256, JSON.stringify(input.fieldSchema), input.kind, input.scope, input.sourceUrl ?? null, input.checkedAt ?? null, input.licenseNote ?? null, input.sampleOnly, JSON.stringify(input.provenance), input.rendererProfileId ?? '00000000-0000-4000-8000-000000000011', actor.userId],
  );
  return { templateId, versionId: v.rows[0]!.id, fileId: stored.fileId };
}

export async function templateRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/templates', async (req, reply) => {
    const actor = requireActor(req);
    const q = parseOrThrow(TemplateListQuerySchema, req.query);
    const rows = await withUserTx(actor, async (tx) => {
      const params: unknown[] = [];
      let where = '';
      if (q.kind) { params.push(q.kind); where += ` AND t.kind = $${params.length + 1}`; }
      if (q.q) { params.push(`%${q.q}%`); where += ` AND t.name LIKE $${params.length + 1}`; }
      let out = await summaryRows(tx, actor.orgId, where, params);
      if (q.status) out = out.filter((t) => (q.status === 'published' ? t.activeVersion?.status === 'published' : t.latestVersionStatus === q.status));
      if (q.scope) out = out.filter((t) => t.activeVersion?.scope === q.scope);
      return out;
    });
    return ok(req, reply, rows);
  });

  app.get('/api/templates/:id', async (req, reply) => {
    const actor = requireActor(req);
    const { id } = req.params as { id: string };
    const data = await withUserTx(actor, async (tx) => {
      const s = await summaryRows(tx, actor.orgId, ' AND t.id = $2', [id]);
      if (!s[0]) throw notFound();
      const v = await tx.query<Row>('SELECT * FROM public.template_versions WHERE template_id = $1 ORDER BY revision DESC', [id]);
      return { ...s[0], versions: v.rows.map(versionOut) };
    });
    return ok(req, reply, data);
  });
  app.get('/api/templates/:id/versions', async (req, reply) => {
    const actor = requireActor(req);
    const { id } = req.params as { id: string };
    const rows = await withUserTx(actor, (tx) => tx.query<Row>('SELECT * FROM public.template_versions WHERE template_id = $1 AND org_id = $2 ORDER BY revision DESC', [id, actor.orgId]).then((r) => r.rows));
    return ok(req, reply, rows.map(versionOut));
  });
  app.get('/api/template-versions/:id', async (req, reply) => {
    const actor = requireActor(req);
    const { id } = req.params as { id: string };
    return ok(req, reply, await withUserTx(actor, async (tx) => versionOut(await loadVersion(tx, id))));
  });
  app.get('/api/template-versions/:id/docx', async (req, reply) => {
    const actor = requireActor(req);
    const { id } = req.params as { id: string };
    const { bytes, name } = await withUserTx(actor, async (tx) => {
      const v = await loadVersion(tx, id);
      const f = await tx.query<{ storage_key: string; original_name_raw: string }>('SELECT storage_key, original_name_raw FROM public.files WHERE id = $1', [v.docx_file_id]);
      if (!f.rows[0]) throw notFound();
      await audit(tx, actor, { action: 'template.docx_downloaded', targetType: 'template_version', targetId: id });
      return { bytes: await blobStore.get(f.rows[0].storage_key), name: f.rows[0].original_name_raw };
    });
    reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    reply.header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(name)}`);
    return reply.send(bytes);
  });

  // 独自 DOCX 登録 → 検査 job
  app.post('/api/templates/import', { config: { auth: { roles: ['admin', 'lawyer', 'staff'] } } }, async (req, reply) => {
    const actor = requireActor(req);
    let fileBuf: Buffer | null = null;
    let fileName = 'template.docx';
    let fieldsRaw: unknown = {};
    for await (const part of req.parts()) {
      if (part.type === 'file') {
        if (part.fieldname !== 'file') { part.file.resume(); continue; }
        fileBuf = await part.toBuffer();
        fileName = part.filename;
      } else if (part.fieldname === 'fields') {
        try { fieldsRaw = JSON.parse(String(part.value)); } catch { throw validationFailed([{ field: 'fields', code: 'invalid_json', message: 'fields は JSON で指定してください' }]); }
      }
    }
    if (!fileBuf) throw validationFailed([{ field: 'file', code: 'required', message: 'DOCX を添付してください' }]);
    if (fileBuf.length > 20 * 1024 * 1024) throw new ApiError(413, 'payload_too_large', '書式 DOCX は 20MB までです');
    if (detectMagic(fileBuf) !== 'zip') throw new ApiError(415, 'file_rejected', 'DOCX（ZIP 構造）ではありません');
    if (/\.docm$/i.test(fileName)) throw new ApiError(415, 'file_rejected', 'DOCM（マクロ有効）は登録できません');
    const fields = parseOrThrow(TemplateImportFieldsSchema, fieldsRaw);
    const data = await withUserTx(actor, async (tx) => {
      if (fields.templateId) {
        const t = await tx.query('SELECT 1 FROM public.templates WHERE id = $1 AND org_id = $2', [fields.templateId, actor.orgId]);
        if (!t.rowCount) throw notFound();
      }
      const initialSchema = { schemaVersion: 1, kind: fields.kind, title: fields.name, scope: fields.scope, recipientTypes: ['opponent_agent', 'opponent', 'client', 'court', 'third_party', 'none'], fields: [{ key: 'subject', type: 'text', label: '件名', source: 'input', required: false }], bodyTag: 'body_text', attachments: true, honorificKeys: ['recipient_name'] };
      const created = await createTemplateVersion(tx, actor, { templateId: fields.templateId ?? null, name: fields.name, kind: fields.kind, scope: fields.scope, docxBytes: fileBuf!, originalName: fileName, fieldSchema: initialSchema, provenance: { source: 'user_upload', uploadedBy: actor.userId, originalName: fileName, supervised: false }, sourceUrl: fields.sourceUrl ?? null, checkedAt: fields.checkedAt ?? null, licenseNote: fields.licenseNote ?? null, sampleOnly: true });
      const job = await enqueueJob(tx, actor, { type: 'inspect_template', scopeKey: `template_version:${created.versionId}`, payload: { templateVersionId: created.versionId, fileId: created.fileId } });
      await audit(tx, actor, { action: 'template.imported', targetType: 'template_version', targetId: created.versionId, details: { templateId: created.templateId, jobId: job.jobId } });
      return { templateId: created.templateId, versionId: created.versionId, jobId: job.jobId };
    });
    return ok(req, reply, data, {}, 202);
  });

  // スキーマ/タグ対応の保存（published は不可）
  app.put('/api/template-versions/:id/schema', async (req, reply) => {
    const actor = requireActor(req);
    const { id } = req.params as { id: string };
    const body = parseOrThrow(TemplateSchemaUpdateSchema, req.body);
    const out = await withUserTx(actor, async (tx) => {
      const v = await loadVersion(tx, id);
      if ((v.version as number) !== body.expectedVersion) throw versionConflict(v.version as number);
      if (v.status === 'published' || v.status === 'retired') throw conflict('公開済み/廃止済みの版は編集できません。複製して新しい版を作成してください');
      const report = (v.inspection_report as { tags?: DiscoveredTag[] } | null) ?? null;
      const issues = validateTemplateSchema(body.fieldSchema, report?.tags ?? []);
      const errors = issues.filter((i) => i.severity === 'error');
      if (errors.length) throw new ApiError(422, 'validation_failed', 'スキーマに問題があります', { fieldErrors: errors.map((e) => ({ field: e.fieldKey ?? e.tag ?? 'schema', code: e.code, message: e.message })) });
      // 案件原資料の参照をテンプレートへ持ち込まない
      const sj = JSON.stringify(body.fieldSchema);
      if (/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i.test(sj)) throw validationFailed([{ field: 'fieldSchema', code: 'id_reference', message: 'スキーマに案件内 ID を含めないでください' }]);
      await tx.query(`UPDATE public.template_versions SET field_schema = $3, tag_map = $4, renderer_profile_id = COALESCE($5, renderer_profile_id), status = CASE WHEN status = 'testing' THEN 'draft' ELSE status END WHERE id = $1 AND version = $2`, [id, body.expectedVersion, JSON.stringify(body.fieldSchema), JSON.stringify(body.tagMap), body.rendererProfileId ?? null]);
      await audit(tx, actor, { action: 'template.schema_updated', targetType: 'template_version', targetId: id, details: { warnings: issues.filter((i) => i.severity === 'warning').map((i) => i.code) } });
      return { version: versionOut(await loadVersion(tx, id)), warnings: issues.filter((i) => i.severity === 'warning') };
    });
    return ok(req, reply, out.version, { warnings: out.warnings });
  });

  // 架空データで試作
  app.post('/api/template-versions/:id/test', async (req, reply) => {
    const actor = requireActor(req);
    const { id } = req.params as { id: string };
    const body = parseOrThrow(TemplateTestRequestSchema, req.body ?? {});
    const data = await withUserTx(actor, async (tx) => {
      const v = await loadVersion(tx, id);
      if (v.status === 'retired') throw conflict('廃止済みの版です');
      const job = await enqueueJob(tx, actor, { type: 'test_template', scopeKey: `template_version:${id}`, payload: { templateVersionId: id, sampleValues: body.sampleValues ?? null, nonce: Date.now() } });
      if (v.status === 'draft') await tx.query(`UPDATE public.template_versions SET status = 'testing' WHERE id = $1 AND status = 'draft'`, [id]);
      await audit(tx, actor, { action: 'template.test_requested', targetType: 'template_version', targetId: id, details: { jobId: job.jobId } });
      return { jobId: job.jobId };
    });
    return ok(req, reply, data, {}, 202);
  });

  // 公開（lawyer のみ・MFA 15 分以内・確認 3 点）
  app.post('/api/template-versions/:id/publish', { config: { auth: { roles: ['lawyer'], requireRecentMfa: true } } }, async (req, reply) => {
    const actor = requireActor(req);
    const { id } = req.params as { id: string };
    const body = parseOrThrow(TemplatePublishSchema, req.body);
    const out = await withUserTx(actor, async (tx) => {
      const v = await loadVersion(tx, id);
      if ((v.version as number) !== body.expectedVersion) throw versionConflict(v.version as number);
      if (!canTransitionTemplateVersion(v.status as 'draft', 'published')) throw conflict(`状態 ${v.status as string} からは公開できません（先に試作してください）`);
      const report = (v.inspection_report as { ok?: boolean; issues?: Array<{ severity: string }>; tags?: DiscoveredTag[] } | null) ?? null;
      if (!report) throw conflict('検査が完了していません');
      if (report.issues?.some((i) => i.severity === 'error')) throw conflict('検査エラーが残っている版は公開できません');
      const parsed = parseTemplateFieldSchema(v.field_schema);
      if (!parsed.schema) throw conflict('スキーマが不正です');
      const issues = validateTemplateSchema(parsed.schema, report.tags ?? []);
      if (issues.some((i) => i.severity === 'error')) throw new ApiError(422, 'validation_failed', 'スキーマ検査に失敗しました', { fieldErrors: issues.filter((i) => i.severity === 'error').map((e) => ({ field: e.fieldKey ?? e.tag ?? 'schema', code: e.code, message: e.message })) });
      const tested = await tx.query(`SELECT 1 FROM public.jobs WHERE type = 'test_template' AND state = 'succeeded' AND payload ->> 'templateVersionId' = $1 AND updated_at >= $2`, [id, v.updated_at]);
      if (!tested.rowCount) throw conflict('最新のスキーマで試作出力が成功していません');
      if (!body.sampleOnly) {
        // 所内書式版として承認: 承認者名をコードで固定しない（actor）
        const l = await tx.query('SELECT 1 FROM public.lawyers WHERE org_id = $1 AND user_id = $2 AND active', [actor.orgId, actor.userId]);
        if (!l.rowCount) throw forbidden('所内弁護士として登録されたユーザーのみ正式書式版を承認できます');
      }
      // 既公開版は retired にせず残す（過去文書は書き換わらない）。active_version を切替。
      await tx.query(
        `UPDATE public.template_versions SET status = 'published', sample_only = $3, approved_by = $4, approved_at = now(), applicability = COALESCE($5, applicability), source_url = COALESCE($6, source_url), checked_at = COALESCE($7, checked_at), license_note = COALESCE($8, license_note) WHERE id = $1 AND version = $2`,
        [id, body.expectedVersion, body.sampleOnly, actor.userId, body.applicability ? JSON.stringify(body.applicability) : null, body.sourceUrl ?? null, body.checkedAt ?? null, body.licenseNote ?? null],
      );
      await tx.query('UPDATE public.templates SET active_version_id = $2 WHERE id = $1', [v.template_id, id]);
      await audit(tx, actor, { action: 'template.published', targetType: 'template_version', targetId: id, targetHash: v.docx_sha256 as string, details: { sampleOnly: body.sampleOnly, confirmations: body.confirmations } });
      return versionOut(await loadVersion(tx, id));
    });
    return ok(req, reply, out);
  });

  app.post('/api/template-versions/:id/retire', { config: { auth: { roles: ['admin', 'lawyer'] } } }, async (req, reply) => {
    const actor = requireActor(req);
    const { id } = req.params as { id: string };
    const body = parseOrThrow(TemplateRetireSchema, req.body);
    const out = await withUserTx(actor, async (tx) => {
      const v = await loadVersion(tx, id);
      if ((v.version as number) !== body.expectedVersion) throw versionConflict(v.version as number);
      if (!canTransitionTemplateVersion(v.status as 'draft', 'retired')) throw conflict('既に廃止済みです');
      await tx.query(`UPDATE public.template_versions SET status = 'retired' WHERE id = $1 AND version = $2`, [id, body.expectedVersion]);
      await tx.query('UPDATE public.templates SET active_version_id = NULL WHERE id = $1 AND active_version_id = $2', [v.template_id, id]);
      await audit(tx, actor, { action: 'template.retired', targetType: 'template_version', targetId: id, details: { reason: body.reasonRaw ?? null } });
      return versionOut(await loadVersion(tx, id));
    });
    return ok(req, reply, out);
  });

  // ---------- 文例 ----------
  app.get('/api/phrases', async (req, reply) => {
    const actor = requireActor(req);
    const q = parseOrThrow(z.object({ category: z.string().optional(), templateKind: z.string().optional() }), req.query);
    const rows = await withUserTx(actor, async (tx) => {
      const r = await tx.query<Row>('SELECT * FROM public.phrase_libraries WHERE org_id = $1 AND ($2::text IS NULL OR category = $2) AND ($3::text IS NULL OR template_kind = $3) ORDER BY category, title', [actor.orgId, q.category ?? null, q.templateKind ?? null]);
      const out: Phrase[] = [];
      for (const p of r.rows) {
        const v = await tx.query<Row>('SELECT * FROM public.phrase_versions WHERE phrase_id = $1 ORDER BY revision DESC', [p.id]);
        out.push(phraseOut(p, v.rows));
      }
      return out;
    });
    return ok(req, reply, rows);
  });
  app.post('/api/phrases', async (req, reply) => {
    const actor = requireActor(req);
    const body = parseOrThrow(PhraseInputSchema, req.body);
    const out = await withUserTx(actor, async (tx) => {
      const p = await tx.query<{ id: string }>('INSERT INTO public.phrase_libraries (org_id, title, category, template_kind, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING id', [actor.orgId, body.title, body.category, body.templateKind ?? null, actor.userId]);
      const v = await tx.query<{ id: string }>(`INSERT INTO public.phrase_versions (org_id, phrase_id, revision, body_raw, status, created_by) VALUES ($1, $2, 1, $3, 'draft', $4) RETURNING id`, [actor.orgId, p.rows[0]!.id, body.bodyRaw, actor.userId]);
      await tx.query('UPDATE public.phrase_libraries SET current_version_id = $2 WHERE id = $1', [p.rows[0]!.id, v.rows[0]!.id]);
      await audit(tx, actor, { action: 'phrase.created', targetType: 'phrase', targetId: p.rows[0]!.id });
      return loadPhrase(tx, p.rows[0]!.id);
    });
    return ok(req, reply, out, {}, 201);
  });
  app.get('/api/phrases/:id', async (req, reply) => {
    const actor = requireActor(req);
    const { id } = req.params as { id: string };
    return ok(req, reply, await withUserTx(actor, (tx) => loadPhrase(tx, id)));
  });
  app.post('/api/phrases/:id/versions', async (req, reply) => {
    const actor = requireActor(req);
    const { id } = req.params as { id: string };
    const body = parseOrThrow(PhraseVersionInputSchema, req.body);
    const out = await withUserTx(actor, async (tx) => {
      const p = await tx.query<Row>('SELECT * FROM public.phrase_libraries WHERE id = $1 FOR UPDATE', [id]);
      if (!p.rows[0]) throw notFound();
      const rev = await tx.query<{ n: number }>('SELECT COALESCE(max(revision), 0) + 1 AS n FROM public.phrase_versions WHERE phrase_id = $1', [id]);
      const v = await tx.query<{ id: string }>(`INSERT INTO public.phrase_versions (org_id, phrase_id, revision, body_raw, status, created_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`, [p.rows[0].org_id, id, rev.rows[0]!.n, body.bodyRaw, body.requestApproval ? 'pending_approval' : 'draft', actor.userId]);
      // 旧文例を使う草案には更新候補のみ（ここでは何もしない）
      await tx.query('UPDATE public.phrase_libraries SET current_version_id = $2 WHERE id = $1', [id, v.rows[0]!.id]);
      await audit(tx, actor, { action: 'phrase.version_saved', targetType: 'phrase_version', targetId: v.rows[0]!.id });
      return loadPhrase(tx, id);
    });
    return ok(req, reply, out, {}, 201);
  });
  app.post('/api/phrase-versions/:id/approve', { config: { auth: { roles: ['lawyer'] } } }, async (req, reply) => {
    const actor = requireActor(req);
    const { id } = req.params as { id: string };
    parseOrThrow(PhraseApproveSchema, req.body);
    const out = await withUserTx(actor, async (tx) => {
      const v = await tx.query<Row>('SELECT * FROM public.phrase_versions WHERE id = $1 FOR UPDATE', [id]);
      const row = v.rows[0];
      if (!row) throw notFound();
      if (row.created_by === actor.userId) throw forbidden('作成者本人は承認できません');
      await tx.query(`UPDATE public.phrase_versions SET status = 'approved', approved_by = $2, approved_at = now() WHERE id = $1`, [id, actor.userId]);
      await audit(tx, actor, { action: 'phrase.approved', targetType: 'phrase_version', targetId: id });
      return loadPhrase(tx, row.phrase_id as string);
    });
    return ok(req, reply, out);
  });

  app.get('/api/renderer-profiles', async (req, reply) => {
    const actor = requireActor(req);
    const rows = await withUserTx(actor, (tx) => tx.query<Row>('SELECT * FROM public.renderer_profiles WHERE org_id IS NULL OR org_id = $1 ORDER BY org_id NULLS FIRST, name', [actor.orgId]).then((r) => r.rows));
    return ok(req, reply, rows.map((r) => ({ id: r.id, orgId: r.org_id ?? null, name: r.name, settings: r.settings, version: r.version })));
  });
  app.get('/api/court-profiles', async (req, reply) => {
    const actor = requireActor(req);
    const rows = await withUserTx(actor, (tx) => tx.query<Row>('SELECT * FROM public.court_profiles WHERE org_id IS NULL OR org_id = $1 ORDER BY org_id NULLS FIRST, name', [actor.orgId]).then((r) => r.rows));
    return ok(req, reply, rows.map((r) => ({ id: r.id, orgId: r.org_id ?? null, version: r.version, name: r.name, sourceUrl: r.source_url ?? null, checkedAt: r.checked_at ?? null, applicableProcedure: r.applicable_procedure, fileRules: r.file_rules, pageRules: r.page_rules, namingRules: r.naming_rules })));
  });
}
