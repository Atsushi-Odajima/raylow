import type { FastifyInstance } from 'fastify';
import { AuditQuerySchema, OrgSettingsUpdateSchema, SearchQuerySchema } from '@raylow/contracts';
import { buildSearchKey } from '@raylow/japanese-text';
import { withUserTx } from '../db/pool.js';
import { requireActor } from '../plugins/auth.js';
import { ok } from '../lib/reply.js';
import { decodeCursor, encodeCursor, parseOrThrow } from '../lib/validate.js';
import { updateWithVersion } from '../lib/sql.js';
import { audit } from '../services/audit.js';

export async function miscRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/health', { config: { auth: { public: true } } }, async (req, reply) => ok(req, reply, { ok: true, time: new Date().toISOString() }));

  app.get('/api/home/create', async (req, reply) => {
    const actor = requireActor(req);
    const data = await withUserTx(actor, async (tx) => {
      const office = await tx.query('SELECT 1 FROM public.office_profiles WHERE org_id = $1 AND is_current', [actor.orgId]);
      const lawyers = await tx.query('SELECT 1 FROM public.lawyers WHERE org_id = $1 AND active LIMIT 1', [actor.orgId]);
      const frequent = await tx.query<{ template_id: string; version_id: string; name: string; kind: string; sample_only: boolean; status: string; uses: string }>(
        `SELECT t.id AS template_id, tv.id AS version_id, t.name, t.kind, tv.sample_only, tv.status,
                (SELECT count(*) FROM public.drafts d WHERE d.template_id = t.id) AS uses
         FROM public.templates t JOIN public.template_versions tv ON tv.id = t.active_version_id
         WHERE t.org_id = $1 AND tv.status = 'published'
         ORDER BY uses DESC, t.kind LIMIT 8`,
        [actor.orgId],
      );
      const recent = await tx.query<{ id: string; title_raw: string; kind: string; status: string; matter_title_raw: string; updated_at: string }>(
        `SELECT d.id, d.title_raw, d.kind, d.status, m.title_raw AS matter_title_raw, d.updated_at FROM public.drafts d JOIN public.matters m ON m.id = d.matter_id
         WHERE d.org_id = $1 AND d.status NOT IN ('archived', 'superseded') ORDER BY d.updated_at DESC LIMIT 8`,
        [actor.orgId],
      );
      const pending = await tx.query<{ review_id: string; draft_id: string; title_raw: string; matter_title_raw: string; requested_by_name: string | null; created_at: string }>(
        `SELECT rv.id AS review_id, d.id AS draft_id, d.title_raw, m.title_raw AS matter_title_raw, u.display_name_raw AS requested_by_name, rv.created_at
         FROM public.reviews rv JOIN public.draft_revisions r ON r.id = rv.revision_id JOIN public.drafts d ON d.id = r.draft_id JOIN public.matters m ON m.id = d.matter_id
         LEFT JOIN public.app_users u ON u.id = rv.requested_by
         WHERE rv.org_id = $1 AND rv.status = 'pending' AND (rv.reviewer_id = $2 OR rv.reviewer_id IS NULL) ORDER BY rv.created_at LIMIT 8`,
        [actor.orgId, actor.userId],
      );
      return {
        needsSetup: office.rowCount === 0 || lawyers.rowCount === 0,
        frequentTemplates: frequent.rows.map((r) => ({ templateId: r.template_id, versionId: r.version_id, name: r.name, kind: r.kind, sampleOnly: r.sample_only, status: r.status })),
        recentDrafts: recent.rows.map((r) => ({ id: r.id, titleRaw: r.title_raw, kind: r.kind, status: r.status, matterTitleRaw: r.matter_title_raw, updatedAt: r.updated_at })),
        pendingReviews: pending.rows.map((r) => ({ reviewId: r.review_id, draftId: r.draft_id, titleRaw: r.title_raw, matterTitleRaw: r.matter_title_raw, requestedByName: r.requested_by_name, createdAt: r.created_at })),
      };
    });
    return ok(req, reply, data);
  });

  app.get('/api/audit', async (req, reply) => {
    const actor = requireActor(req);
    const q = parseOrThrow(AuditQuerySchema, req.query);
    const cur = decodeCursor<{ t: string; id: string }>(q.cursor);
    const rows = await withUserTx(actor, async (tx) => {
      const r = await tx.query<Record<string, unknown>>(
        `SELECT a.*, u.display_name_raw AS actor_name FROM public.audit_events a LEFT JOIN public.app_users u ON u.id = a.actor_id
         WHERE a.org_id = $1 AND ($2::uuid IS NULL OR a.matter_id = $2) AND ($3::text IS NULL OR a.action = $3)
           AND ($4::timestamptz IS NULL OR (a.created_at, a.id) < ($4::timestamptz, $5::uuid))
         ORDER BY a.created_at DESC, a.id DESC LIMIT $6`,
        [actor.orgId, q.matterId ?? null, q.action ?? null, cur?.t ?? null, cur?.id ?? '00000000-0000-0000-0000-000000000000', q.limit + 1],
      );
      return r.rows;
    });
    const page = rows.slice(0, q.limit);
    const last = page[page.length - 1];
    const nextCursor = rows.length > q.limit && last ? encodeCursor({ t: String(last.created_at), id: String(last.id) }) : null;
    return ok(
      req,
      reply,
      page.map((a) => ({
        id: a.id, orgId: a.org_id, matterId: a.matter_id, actorId: a.actor_id, actorName: a.actor_name ?? null, actorRole: a.actor_role, action: a.action, targetType: a.target_type, targetId: a.target_id, targetVersion: a.target_version, targetHash: a.target_hash, requestId: a.request_id, details: a.details ?? {}, createdAt: a.created_at,
      })),
      { nextCursor },
    );
  });

  app.get('/api/search', async (req, reply) => {
    const actor = requireActor(req);
    const q = parseOrThrow(SearchQuerySchema, req.query);
    const key = buildSearchKey(q.q).key;
    const data = await withUserTx(actor, async (tx) => {
      const like = `%${key.replace(/[%_\\]/g, (c) => '\\' + c)}%`;
      const exactLike = `%${q.q.replace(/[%_\\]/g, (c) => '\\' + c)}%`;
      const contacts = await tx.query<{ id: string; name_raw: string; organization_name_raw: string; address_raw: string; alias_raw: string | null }>(
        q.mode === 'exact'
          ? `SELECT c.id, c.name_raw, c.organization_name_raw, c.address_raw, NULL::text AS alias_raw FROM public.contacts c WHERE c.org_id = $1 AND (c.name_raw LIKE $2 OR c.organization_name_raw LIKE $2 OR c.address_raw LIKE $2) LIMIT $3`
          : `SELECT DISTINCT c.id, c.name_raw, c.organization_name_raw, c.address_raw, a.alias_raw FROM public.contacts c LEFT JOIN public.contact_aliases a ON a.contact_id = c.id AND a.search_key LIKE $2
             WHERE c.org_id = $1 AND (c.search_key LIKE $2 OR a.id IS NOT NULL) LIMIT $3`,
        [actor.orgId, q.mode === 'exact' ? exactLike : like, q.limit],
      );
      const matters = await tx.query<{ id: string; title_raw: string; case_number_raw: string }>(
        q.mode === 'exact' ? `SELECT id, title_raw, case_number_raw FROM public.matters WHERE org_id = $1 AND (title_raw LIKE $2 OR case_number_raw LIKE $2) LIMIT $3` : `SELECT id, title_raw, case_number_raw FROM public.matters WHERE org_id = $1 AND search_key LIKE $2 LIMIT $3`,
        [actor.orgId, q.mode === 'exact' ? exactLike : like, q.limit],
      );
      const docs = await tx.query<{ id: string; title_raw: string; kind: string; status: string; matter_id: string }>(
        `SELECT id, title_raw, kind, status, matter_id FROM public.drafts WHERE org_id = $1 AND title_raw LIKE $2 LIMIT $3`,
        [actor.orgId, exactLike, q.limit],
      );
      const reason = (raw: string) => (raw.includes(q.q) ? 'exact' : 'normalized');
      return {
        contacts: contacts.rows.map((c) => ({ id: c.id, nameRaw: c.name_raw, organizationNameRaw: c.organization_name_raw, addressRaw: c.address_raw, matchReason: c.alias_raw ? 'alias' : reason(`${c.name_raw} ${c.organization_name_raw} ${c.address_raw}`), quote: c.alias_raw ?? c.name_raw })),
        matters: matters.rows.map((m) => ({ id: m.id, titleRaw: m.title_raw, caseNumberRaw: m.case_number_raw, matchReason: reason(`${m.title_raw} ${m.case_number_raw}`), quote: m.title_raw })),
        documents: docs.rows.map((d) => ({ id: d.id, titleRaw: d.title_raw, kind: d.kind, status: d.status, matterId: d.matter_id, matchReason: 'exact', quote: d.title_raw })),
      };
    });
    return ok(req, reply, data);
  });

  app.get('/api/settings', async (req, reply) => {
    const actor = requireActor(req);
    const data = await withUserTx(actor, async (tx) => {
      const o = await tx.query<{ name_raw: string; settings: Record<string, unknown>; version: number }>('SELECT name_raw, settings, version FROM public.organizations WHERE id = $1', [actor.orgId]);
      const row = o.rows[0]!;
      const s = row.settings;
      return {
        name: row.name_raw,
        retentionYears: (s.retentionYears as number | null | undefined) ?? null,
        autoDeleteEnabled: (s.autoDeleteEnabled as boolean | undefined) ?? false,
        minLawyersForApproval: 2,
        backupNote: '日次 DB+Storage+書式+fonts+renderer 設定の暗号化バックアップを運用手順で設定する（RPO 24h / RTO 1 営業日目標。保証契約とは別）',
        storageRegionNote: '保管地域・バックアップ地域・認証メール経路は導入時に確認する。未確認のまま国内完結と宣伝しない',
        version: row.version,
      };
    });
    return ok(req, reply, data);
  });

  app.put('/api/settings', { config: { auth: { roles: ['admin'], requireRecentMfa: true } } }, async (req, reply) => {
    const actor = requireActor(req);
    const body = parseOrThrow(OrgSettingsUpdateSchema, req.body);
    await withUserTx(actor, async (tx) => {
      const cur = await tx.query<{ settings: Record<string, unknown> }>('SELECT settings FROM public.organizations WHERE id = $1', [actor.orgId]);
      const settings = { ...(cur.rows[0]?.settings ?? {}) };
      if (body.retentionYears !== undefined) settings.retentionYears = body.retentionYears;
      if (body.autoDeleteEnabled !== undefined) settings.autoDeleteEnabled = body.autoDeleteEnabled;
      const row = await updateWithVersion<{ version: number }>(
        tx,
        `UPDATE public.organizations SET name_raw = COALESCE($3, name_raw), settings = $4 WHERE id = $1 AND version = $2 RETURNING version`,
        [actor.orgId, body.expectedVersion, body.nameRaw ?? null, JSON.stringify(settings)],
        'organizations',
        actor.orgId,
        body.expectedVersion,
      );
      await audit(tx, actor, { action: 'settings.updated', targetType: 'organization', targetId: actor.orgId, targetVersion: row.version });
    });
    return app.inject({ method: 'GET', url: '/api/settings', headers: { cookie: req.headers.cookie ?? '' } }).then((r) => reply.status(200).send(r.json()));
  });
}
