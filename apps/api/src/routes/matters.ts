import type { FastifyInstance } from 'fastify';
import { AgentInputSchema, BarrierAddSchema, MatterAcceptanceSchema, MatterInputSchema, MatterLegalHoldSchema, MatterListQuerySchema, MatterStatusChangeSchema, MatterUpdateSchema, MemberAddSchema, PartyInputSchema, PartyUpdateSchema, type MatterDetail, type MatterSummary } from '@raylow/contracts';
import { buildSearchKey } from '@raylow/japanese-text';
import { withUserTx, type Actor, type Tx } from '../db/pool.js';
import { ApiError, conflict, forbidden, notFound, versionConflict } from '../errors.js';
import { requireActor } from '../plugins/auth.js';
import { ok } from '../lib/reply.js';
import { decodeCursor, encodeCursor, parseOrThrow } from '../lib/validate.js';
import { audit } from '../services/audit.js';

type Row = Record<string, unknown>;

function summaryOut(r: Row): MatterSummary {
  return {
    id: r.id as string, orgId: r.org_id as string, titleRaw: r.title_raw as string, caseNumberRaw: r.case_number_raw as string, courtRaw: r.court_raw as string, courtDepartmentRaw: r.court_department_raw as string, status: r.status as MatterSummary['status'],
    acceptanceStatus: r.acceptance_status as MatterSummary['acceptanceStatus'], acceptanceCheckedBy: (r.acceptance_checked_by as string | null) ?? null, acceptanceCheckedAt: (r.acceptance_checked_at as string | null) ?? null, scopeRaw: r.scope_raw as string, leadLawyerId: (r.lead_lawyer_id as string | null) ?? null, legalHold: r.legal_hold as boolean, updatedAt: r.updated_at as string, version: r.version as number,
  };
}

export function matterSearchKey(m: { titleRaw: string; caseNumberRaw?: string; courtRaw?: string }): string {
  return buildSearchKey([m.titleRaw, m.caseNumberRaw ?? '', m.courtRaw ?? ''].join(' ')).key;
}

export async function loadMatterDetail(tx: Tx, actor: Actor, id: string): Promise<MatterDetail> {
  const m = await tx.query<Row>('SELECT * FROM public.matters WHERE id = $1', [id]);
  const row = m.rows[0];
  if (!row) throw notFound(); // RLS により他 org / barrier / 未割当は 0 行
  const parties = await tx.query<Row>(
    `SELECT p.*, c.type AS c_type, c.name_raw AS c_name, c.organization_name_raw AS c_org, c.address_raw AS c_addr, c.postcode_raw AS c_post, rc.name_raw AS rep_name
     FROM public.matter_parties p JOIN public.contacts c ON c.id = p.contact_id LEFT JOIN public.contacts rc ON rc.id = p.representative_id WHERE p.matter_id = $1 ORDER BY p.created_at`,
    [id],
  );
  const agents = await tx.query<Row>(
    `SELECT a.*, c.name_raw AS c_name, c.organization_name_raw AS c_org, c.address_raw AS c_addr, c.postcode_raw AS c_post, c.channels_json AS c_ch FROM public.matter_agents a JOIN public.contacts c ON c.id = a.lawyer_contact_id WHERE a.matter_id = $1 ORDER BY a.created_at`,
    [id],
  );
  const members = await tx.query<Row>(`SELECT mm.user_id, mm.can_edit, mm.approved_by, u.display_name_raw, ms.role FROM public.matter_members mm JOIN public.app_users u ON u.id = mm.user_id JOIN public.memberships ms ON ms.org_id = mm.org_id AND ms.user_id = mm.user_id WHERE mm.matter_id = $1 ORDER BY u.display_name_raw`, [id]);
  const flags = await tx.query<{ can_edit: boolean; assigned: boolean }>('SELECT app.can_edit_matter($1) AS can_edit, app.is_assigned_lawyer($1) AS assigned', [id]);
  const docs = await tx.query<{ n: string }>(`SELECT count(*) AS n FROM public.drafts WHERE matter_id = $1 AND status NOT IN ('archived')`, [id]);
  return {
    ...summaryOut(row),
    caseNumberStruct: (row.case_number_struct as MatterDetail['caseNumberStruct']) ?? null,
    archiveReasonRaw: (row.archive_reason_raw as string | null) ?? null,
    parties: parties.rows.map((p) => ({
      id: p.id as string, matterId: id, contactId: p.contact_id as string,
      contact: { id: p.contact_id as string, type: p.c_type as 'person', nameRaw: p.c_name as string, organizationNameRaw: p.c_org as string, addressRaw: p.c_addr as string, postcodeRaw: p.c_post as string },
      role: p.role as 'client', positionRaw: p.position_raw as string, representativeId: (p.representative_id as string | null) ?? null, representative: p.representative_id ? { id: p.representative_id as string, nameRaw: p.rep_name as string } : null, version: p.version as number,
    })),
    agents: agents.rows.map((a) => ({
      id: a.id as string, matterId: id, lawyerContactId: a.lawyer_contact_id as string,
      lawyerContact: { id: a.lawyer_contact_id as string, nameRaw: a.c_name as string, organizationNameRaw: a.c_org as string, addressRaw: a.c_addr as string, postcodeRaw: a.c_post as string, channels: (a.c_ch as Record<string, string>) ?? {} },
      representedPartyId: a.represented_party_id as string, validFrom: (a.valid_from as string | null) ?? null, validTo: (a.valid_to as string | null) ?? null, version: a.version as number,
    })),
    members: members.rows.map((x) => ({ userId: x.user_id as string, displayName: x.display_name_raw as string, role: x.role as string, canEdit: x.can_edit as boolean, approvedBy: (x.approved_by as string | null) ?? null })),
    canEdit: flags.rows[0]!.can_edit,
    isAssignedLawyer: flags.rows[0]!.assigned,
    documentCount: Number(docs.rows[0]!.n),
  };
}

async function requireAssignedLawyer(tx: Tx, matterId: string): Promise<void> {
  const r = await tx.query<{ ok: boolean }>('SELECT app.is_assigned_lawyer($1) AS ok', [matterId]);
  if (!r.rows[0]?.ok) throw forbidden('この操作は案件に割り当てられた弁護士のみ行えます');
}

export async function matterRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/matters', async (req, reply) => {
    const actor = requireActor(req);
    const q = parseOrThrow(MatterListQuerySchema, req.query);
    const cur = decodeCursor<{ u: string; id: string }>(q.cursor);
    const rows = await withUserTx(actor, async (tx) => {
      const params: unknown[] = [actor.orgId, q.limit + 1];
      let where = 'org_id = $1';
      if (q.status) {
        params.push(q.status);
        where += ` AND status = $${params.length}`;
      }
      if (q.q) {
        params.push(`%${buildSearchKey(q.q).key.replace(/[%_\\]/g, (ch) => '\\' + ch)}%`);
        where += ` AND search_key LIKE $${params.length}`;
      }
      if (cur) {
        params.push(cur.u, cur.id);
        where += ` AND (updated_at, id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`;
      }
      const r = await tx.query<Row>(`SELECT * FROM public.matters WHERE ${where} ORDER BY updated_at DESC, id DESC LIMIT $2`, params);
      return r.rows;
    });
    const page = rows.slice(0, q.limit);
    const last = page[page.length - 1];
    const nextCursor = rows.length > q.limit && last ? encodeCursor({ u: last.updated_at as string, id: last.id as string }) : null;
    return ok(req, reply, page.map((r) => { const s = summaryOut(r); if (q.q) s.matchReason = `${s.titleRaw} ${s.caseNumberRaw}`.includes(q.q) ? 'exact' : 'normalized'; return s; }), { nextCursor });
  });

  app.post('/api/matters', async (req, reply) => {
    const actor = requireActor(req);
    const body = parseOrThrow(MatterInputSchema, req.body);
    const detail = await withUserTx(actor, async (tx) => {
      const r = await tx.query<Row>(
        `INSERT INTO public.matters (org_id, title_raw, case_number_raw, case_number_struct, court_raw, court_department_raw, scope_raw, lead_lawyer_id, external_id, search_key, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
        [actor.orgId, body.titleRaw, body.caseNumberRaw, body.caseNumberStruct ? JSON.stringify(body.caseNumberStruct) : null, body.courtRaw, body.courtDepartmentRaw, body.scopeRaw, body.leadLawyerId ?? null, body.externalId ?? null, matterSearchKey(body), actor.userId],
      );
      const id = r.rows[0]!.id as string;
      // 最初の案件作成者に membership を付与
      await tx.query('INSERT INTO public.matter_members (matter_id, user_id, org_id, can_edit, approved_by, created_by) VALUES ($1, $2, $3, true, $2, $2)', [id, actor.userId, actor.orgId]);
      // lead lawyer にも付与
      if (body.leadLawyerId) {
        const l = await tx.query<{ user_id: string | null }>('SELECT user_id FROM public.lawyers WHERE id = $1 AND org_id = $2', [body.leadLawyerId, actor.orgId]);
        const uid = l.rows[0]?.user_id;
        if (uid && uid !== actor.userId) await tx.query('INSERT INTO public.matter_members (matter_id, user_id, org_id, can_edit, approved_by, created_by) VALUES ($1, $2, $3, true, $4, $4) ON CONFLICT DO NOTHING', [id, uid, actor.orgId, actor.userId]);
      }
      await audit(tx, actor, { action: 'matter.created', targetType: 'matter', targetId: id, targetVersion: 1, matterId: id });
      return loadMatterDetail(tx, actor, id);
    });
    return ok(req, reply, detail, {}, 201);
  });

  app.get('/api/matters/:id', async (req, reply) => {
    const actor = requireActor(req);
    const { id } = req.params as { id: string };
    const d = await withUserTx(actor, (tx) => loadMatterDetail(tx, actor, id));
    return ok(req, reply, d);
  });

  app.put('/api/matters/:id', async (req, reply) => {
    const actor = requireActor(req);
    const { id } = req.params as { id: string };
    const body = parseOrThrow(MatterUpdateSchema, req.body);
    const d = await withUserTx(actor, async (tx) => {
      const cur = await tx.query<Row>('SELECT * FROM public.matters WHERE id = $1 FOR UPDATE', [id]);
      const c = cur.rows[0];
      if (!c) throw notFound();
      if ((c.version as number) !== body.expectedVersion) throw versionConflict(c.version as number);
      if (c.status !== 'active') throw conflict('アーカイブ済みの案件は編集できません（理由付きで再開してください）');
      const next = { titleRaw: body.titleRaw ?? (c.title_raw as string), caseNumberRaw: body.caseNumberRaw ?? (c.case_number_raw as string), courtRaw: body.courtRaw ?? (c.court_raw as string), courtDepartmentRaw: body.courtDepartmentRaw ?? (c.court_department_raw as string), scopeRaw: body.scopeRaw ?? (c.scope_raw as string), leadLawyerId: body.leadLawyerId === undefined ? (c.lead_lawyer_id as string | null) : body.leadLawyerId, caseNumberStruct: body.caseNumberStruct === undefined ? c.case_number_struct : body.caseNumberStruct, externalId: body.externalId === undefined ? (c.external_id as string | null) : body.externalId };
      const r = await tx.query<Row>(
        `UPDATE public.matters SET title_raw = $3, case_number_raw = $4, case_number_struct = $5, court_raw = $6, court_department_raw = $7, scope_raw = $8, lead_lawyer_id = $9, external_id = $10, search_key = $11 WHERE id = $1 AND version = $2 RETURNING version`,
        [id, body.expectedVersion, next.titleRaw, next.caseNumberRaw, next.caseNumberStruct ? JSON.stringify(next.caseNumberStruct) : null, next.courtRaw, next.courtDepartmentRaw, next.scopeRaw, next.leadLawyerId, next.externalId, matterSearchKey(next)],
      );
      if (!r.rows[0]) throw notFound();
      await audit(tx, actor, { action: 'matter.updated', targetType: 'matter', targetId: id, targetVersion: r.rows[0].version as number, matterId: id, details: { note: '過去書面は変化しない。草案には更新候補のみ' } });
      return loadMatterDetail(tx, actor, id);
    });
    return ok(req, reply, d);
  });

  app.post('/api/matters/:id/acceptance', async (req, reply) => {
    const actor = requireActor(req);
    const { id } = req.params as { id: string };
    const body = parseOrThrow(MatterAcceptanceSchema, req.body);
    const d = await withUserTx(actor, async (tx) => {
      await requireAssignedLawyer(tx, id);
      const r = await tx.query<{ version: number }>(`UPDATE public.matters SET acceptance_status = $3, acceptance_checked_by = $4, acceptance_checked_at = now() WHERE id = $1 AND version = $2 RETURNING version`, [id, body.expectedVersion, body.acceptanceStatus, actor.userId]);
      if (!r.rows[0]) {
        const cur = await tx.query<{ version: number }>('SELECT version FROM public.matters WHERE id = $1', [id]);
        if (!cur.rows[0]) throw notFound();
        throw versionConflict(cur.rows[0].version);
      }
      await audit(tx, actor, { action: 'matter.acceptance_checked', targetType: 'matter', targetId: id, targetVersion: r.rows[0].version, matterId: id, details: { acceptanceStatus: body.acceptanceStatus } });
      return loadMatterDetail(tx, actor, id);
    });
    return ok(req, reply, d);
  });

  app.post('/api/matters/:id/status', async (req, reply) => {
    const actor = requireActor(req);
    const { id } = req.params as { id: string };
    const body = parseOrThrow(MatterStatusChangeSchema, req.body);
    const d = await withUserTx(actor, async (tx) => {
      await requireAssignedLawyer(tx, id);
      const cur = await tx.query<Row>('SELECT * FROM public.matters WHERE id = $1 FOR UPDATE', [id]);
      const c = cur.rows[0];
      if (!c) throw notFound();
      if ((c.version as number) !== body.expectedVersion) throw versionConflict(c.version as number);
      if (c.status !== 'active' && body.status === 'active' && !body.reasonRaw) throw new ApiError(422, 'validation_failed', '再開には理由が必要です', { fieldErrors: [{ field: 'reasonRaw', code: 'required', message: '理由を入力してください' }] });
      // archived 案件への書込みは RLS(can_edit_matter) で止まるため、ここでは service を使わず matters_update policy で許可される範囲（status 列）を更新する
      const r = await tx.query<{ version: number }>(`UPDATE public.matters SET status = $3, archive_reason_raw = $4 WHERE id = $1 AND version = $2 RETURNING version`, [id, body.expectedVersion, body.status, body.reasonRaw ?? null]);
      if (!r.rows[0]) throw notFound();
      await audit(tx, actor, { action: 'matter.status_changed', targetType: 'matter', targetId: id, targetVersion: r.rows[0].version, matterId: id, details: { status: body.status, reason: body.reasonRaw ?? null } });
      return loadMatterDetail(tx, actor, id);
    });
    return ok(req, reply, d);
  });

  app.post('/api/matters/:id/legal-hold', async (req, reply) => {
    const actor = requireActor(req);
    const { id } = req.params as { id: string };
    const body = parseOrThrow(MatterLegalHoldSchema, req.body);
    const d = await withUserTx(actor, async (tx) => {
      await requireAssignedLawyer(tx, id);
      const r = await tx.query<{ version: number }>(`UPDATE public.matters SET legal_hold = $3 WHERE id = $1 AND version = $2 RETURNING version`, [id, body.expectedVersion, body.legalHold]);
      if (!r.rows[0]) {
        const cur = await tx.query<{ version: number }>('SELECT version FROM public.matters WHERE id = $1', [id]);
        if (!cur.rows[0]) throw notFound();
        throw versionConflict(cur.rows[0].version);
      }
      await audit(tx, actor, { action: 'matter.legal_hold', targetType: 'matter', targetId: id, targetVersion: r.rows[0].version, matterId: id, details: { legalHold: body.legalHold, reason: body.reasonRaw ?? null } });
      return loadMatterDetail(tx, actor, id);
    });
    return ok(req, reply, d);
  });

  // ---------- parties ----------
  app.post('/api/matters/:id/parties', async (req, reply) => {
    const actor = requireActor(req);
    const { id } = req.params as { id: string };
    const body = parseOrThrow(PartyInputSchema, req.body);
    const d = await withUserTx(actor, async (tx) => {
      const m = await tx.query<{ org_id: string }>('SELECT org_id FROM public.matters WHERE id = $1', [id]);
      if (!m.rows[0]) throw notFound();
      const r = await tx.query<{ id: string }>('INSERT INTO public.matter_parties (org_id, matter_id, contact_id, role, position_raw, representative_id, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id', [m.rows[0].org_id, id, body.contactId, body.role, body.positionRaw, body.representativeId ?? null, actor.userId]);
      await audit(tx, actor, { action: 'matter.party_added', targetType: 'matter_party', targetId: r.rows[0]!.id, matterId: id, details: { role: body.role } });
      return loadMatterDetail(tx, actor, id);
    });
    return ok(req, reply, d, {}, 201);
  });
  app.put('/api/matters/:id/parties/:partyId', async (req, reply) => {
    const actor = requireActor(req);
    const { id, partyId } = req.params as { id: string; partyId: string };
    const body = parseOrThrow(PartyUpdateSchema, req.body);
    const d = await withUserTx(actor, async (tx) => {
      const cur = await tx.query<Row>('SELECT * FROM public.matter_parties WHERE id = $1 AND matter_id = $2 FOR UPDATE', [partyId, id]);
      const c = cur.rows[0];
      if (!c) throw notFound();
      if ((c.version as number) !== body.expectedVersion) throw versionConflict(c.version as number);
      await tx.query('UPDATE public.matter_parties SET contact_id = $3, role = $4, position_raw = $5, representative_id = $6 WHERE id = $1 AND version = $2', [partyId, body.expectedVersion, body.contactId ?? c.contact_id, body.role ?? c.role, body.positionRaw ?? c.position_raw, body.representativeId === undefined ? c.representative_id : body.representativeId]);
      await audit(tx, actor, { action: 'matter.party_updated', targetType: 'matter_party', targetId: partyId, matterId: id });
      return loadMatterDetail(tx, actor, id);
    });
    return ok(req, reply, d);
  });
  app.delete('/api/matters/:id/parties/:partyId', async (req, reply) => {
    const actor = requireActor(req);
    const { id, partyId } = req.params as { id: string; partyId: string };
    const d = await withUserTx(actor, async (tx) => {
      const r = await tx.query('DELETE FROM public.matter_parties WHERE id = $1 AND matter_id = $2', [partyId, id]);
      if (!r.rowCount) throw notFound();
      await audit(tx, actor, { action: 'matter.party_removed', targetType: 'matter_party', targetId: partyId, matterId: id });
      return loadMatterDetail(tx, actor, id);
    });
    return ok(req, reply, d);
  });

  // ---------- agents（party と agent は別関係） ----------
  app.post('/api/matters/:id/agents', async (req, reply) => {
    const actor = requireActor(req);
    const { id } = req.params as { id: string };
    const body = parseOrThrow(AgentInputSchema, req.body);
    const d = await withUserTx(actor, async (tx) => {
      const m = await tx.query<{ org_id: string }>('SELECT org_id FROM public.matters WHERE id = $1', [id]);
      if (!m.rows[0]) throw notFound();
      const p = await tx.query('SELECT 1 FROM public.matter_parties WHERE id = $1 AND matter_id = $2', [body.representedPartyId, id]);
      if (!p.rowCount) throw new ApiError(422, 'validation_failed', '代理する当事者がこの案件に存在しません', { fieldErrors: [{ field: 'representedPartyId', code: 'invalid', message: 'この案件の当事者を選んでください' }] });
      const r = await tx.query<{ id: string }>('INSERT INTO public.matter_agents (org_id, matter_id, lawyer_contact_id, represented_party_id, valid_from, valid_to, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id', [m.rows[0].org_id, id, body.lawyerContactId, body.representedPartyId, body.validFrom ?? null, body.validTo ?? null, actor.userId]);
      await audit(tx, actor, { action: 'matter.agent_added', targetType: 'matter_agent', targetId: r.rows[0]!.id, matterId: id });
      return loadMatterDetail(tx, actor, id);
    });
    return ok(req, reply, d, {}, 201);
  });
  app.delete('/api/matters/:id/agents/:agentId', async (req, reply) => {
    const actor = requireActor(req);
    const { id, agentId } = req.params as { id: string; agentId: string };
    const d = await withUserTx(actor, async (tx) => {
      const r = await tx.query('DELETE FROM public.matter_agents WHERE id = $1 AND matter_id = $2', [agentId, id]);
      if (!r.rowCount) throw notFound();
      await audit(tx, actor, { action: 'matter.agent_removed', targetType: 'matter_agent', targetId: agentId, matterId: id });
      return loadMatterDetail(tx, actor, id);
    });
    return ok(req, reply, d);
  });

  // ---------- members / barriers（担当 lawyer 承認） ----------
  app.post('/api/matters/:id/members', async (req, reply) => {
    const actor = requireActor(req);
    const { id } = req.params as { id: string };
    const body = parseOrThrow(MemberAddSchema, req.body);
    const d = await withUserTx(actor, async (tx) => {
      await requireAssignedLawyer(tx, id);
      const m = await tx.query<{ org_id: string }>('SELECT org_id FROM public.matters WHERE id = $1', [id]);
      if (!m.rows[0]) throw notFound();
      const ms = await tx.query('SELECT 1 FROM public.memberships WHERE org_id = $1 AND user_id = $2 AND status = $3', [m.rows[0].org_id, body.userId, 'active']);
      if (!ms.rowCount) throw new ApiError(422, 'validation_failed', '所内ユーザーではありません', { fieldErrors: [{ field: 'userId', code: 'invalid', message: '所内の有効なユーザーを選んでください' }] });
      const b = await tx.query('SELECT 1 FROM public.matter_barriers WHERE matter_id = $1 AND user_id = $2', [id, body.userId]);
      if (b.rowCount) throw conflict('このユーザーには閲覧制限（barrier）が設定されています');
      await tx.query('INSERT INTO public.matter_members (matter_id, user_id, org_id, can_edit, approved_by, created_by) VALUES ($1, $2, $3, $4, $5, $5) ON CONFLICT (matter_id, user_id) DO UPDATE SET can_edit = EXCLUDED.can_edit, approved_by = EXCLUDED.approved_by', [id, body.userId, m.rows[0].org_id, body.canEdit, actor.userId]);
      await audit(tx, actor, { action: 'matter.member_added', targetType: 'matter_member', targetId: body.userId, matterId: id, details: { canEdit: body.canEdit } });
      return loadMatterDetail(tx, actor, id);
    });
    return ok(req, reply, d, {}, 201);
  });
  app.delete('/api/matters/:id/members/:userId', async (req, reply) => {
    const actor = requireActor(req);
    const { id, userId } = req.params as { id: string; userId: string };
    const d = await withUserTx(actor, async (tx) => {
      await requireAssignedLawyer(tx, id);
      const lawyers = await tx.query<{ n: string }>(`SELECT count(*) AS n FROM public.matter_members mm JOIN public.matters mt ON mt.id = mm.matter_id JOIN public.memberships ms ON ms.org_id = mt.org_id AND ms.user_id = mm.user_id AND ms.role = 'lawyer' WHERE mm.matter_id = $1 AND mm.user_id <> $2`, [id, userId]);
      if (Number(lawyers.rows[0]!.n) === 0) throw conflict('担当弁護士が不在になります。先に引継ぎ先の弁護士を追加してください');
      const r = await tx.query('DELETE FROM public.matter_members WHERE matter_id = $1 AND user_id = $2', [id, userId]);
      if (!r.rowCount) throw notFound();
      await audit(tx, actor, { action: 'matter.member_removed', targetType: 'matter_member', targetId: userId, matterId: id });
      return loadMatterDetail(tx, actor, id);
    });
    return ok(req, reply, d);
  });
  app.post('/api/matters/:id/barriers', async (req, reply) => {
    const actor = requireActor(req);
    const { id } = req.params as { id: string };
    const body = parseOrThrow(BarrierAddSchema, req.body);
    const d = await withUserTx(actor, async (tx) => {
      await requireAssignedLawyer(tx, id);
      const m = await tx.query<{ org_id: string }>('SELECT org_id FROM public.matters WHERE id = $1', [id]);
      if (!m.rows[0]) throw notFound();
      await tx.query('DELETE FROM public.matter_members WHERE matter_id = $1 AND user_id = $2', [id, body.userId]);
      await tx.query('INSERT INTO public.matter_barriers (matter_id, user_id, org_id, reason, created_by) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (matter_id, user_id) DO UPDATE SET reason = EXCLUDED.reason', [id, body.userId, m.rows[0].org_id, body.reason, actor.userId]);
      await audit(tx, actor, { action: 'matter.barrier_added', targetType: 'matter_barrier', targetId: body.userId, matterId: id });
      return loadMatterDetail(tx, actor, id);
    });
    return ok(req, reply, d, {}, 201);
  });
}
