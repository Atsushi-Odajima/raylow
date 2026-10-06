import type { FastifyInstance } from 'fastify';
import { ContactInputSchema, ContactSearchQuerySchema, ContactUpdateSchema, LawyerInputSchema, LawyerUpdateSchema, MemberInviteSchema, OfficeProfileInputSchema, OfficeProfileUpdateSchema, type Contact, type Lawyer, type Member, type OfficeProfile } from '@raylow/contracts';
import { buildSearchKey } from '@raylow/japanese-text';
import { z } from 'zod';
import { withServiceTx, withUserTx, type Tx } from '../db/pool.js';
import { ApiError, conflict, forbidden, notFound, versionConflict } from '../errors.js';
import { requireActor } from '../plugins/auth.js';
import { ok } from '../lib/reply.js';
import { decodeCursor, encodeCursor, parseOrThrow } from '../lib/validate.js';
import { audit } from '../services/audit.js';
import { hashPassword, randomToken } from '../auth/crypto.js';

type Row = Record<string, unknown>;

function officeOut(r: Row): OfficeProfile {
  return {
    id: r.id as string, orgId: r.org_id as string, revision: r.revision as number, nameRaw: r.name_raw as string, addressRaw: r.address_raw as string, postcodeRaw: r.postcode_raw as string, phoneRaw: r.phone_raw as string, faxRaw: r.fax_raw as string, emailRaw: r.email_raw as string,
    signatureSettings: (r.signature_settings as Record<string, unknown>) ?? {}, honorificSettings: r.honorific_settings as OfficeProfile['honorificSettings'], isCurrent: r.is_current as boolean, createdAt: r.created_at as string, version: r.version as number,
  };
}
function lawyerOut(r: Row): Lawyer {
  return { id: r.id as string, orgId: r.org_id as string, userId: (r.user_id as string | null) ?? null, nameRaw: r.name_raw as string, kana: r.kana as string, titleRaw: r.title_raw as string, registrationNumberRaw: r.registration_number_raw as string, officeProfileId: (r.office_profile_id as string | null) ?? null, active: r.active as boolean, version: r.version as number };
}
export function contactOut(r: Row, aliases: Array<{ id: string; alias_raw: string }> = []): Contact {
  return {
    id: r.id as string, orgId: r.org_id as string, type: r.type as Contact['type'], nameRaw: r.name_raw as string, kana: r.kana as string, organizationNameRaw: r.organization_name_raw as string, addressRaw: r.address_raw as string, postcodeRaw: r.postcode_raw as string,
    channels: (r.channels_json as Contact['channels']) ?? {}, externalId: (r.external_id as string | null) ?? null, checkedAt: (r.checked_at as string | null) ?? null, notesRaw: r.notes_raw as string, aliases: aliases.map((a) => ({ id: a.id, aliasRaw: a.alias_raw })),
    createdAt: r.created_at as string, updatedAt: r.updated_at as string, version: r.version as number,
  };
}

export function contactSearchKey(c: { nameRaw: string; kana?: string; organizationNameRaw?: string; addressRaw?: string }): string {
  return buildSearchKey([c.nameRaw, c.kana ?? '', c.organizationNameRaw ?? '', c.addressRaw ?? ''].join(' ')).key;
}

async function loadContact(tx: Tx, id: string): Promise<Contact> {
  const r = await tx.query<Row>('SELECT * FROM public.contacts WHERE id = $1', [id]);
  if (!r.rows[0]) throw notFound();
  const a = await tx.query<{ id: string; alias_raw: string }>('SELECT id, alias_raw FROM public.contact_aliases WHERE contact_id = $1 ORDER BY created_at', [id]);
  return contactOut(r.rows[0], a.rows);
}

async function snapshotContact(tx: Tx, contactId: string, userId: string): Promise<void> {
  const r = await tx.query<Row>('SELECT * FROM public.contacts WHERE id = $1', [contactId]);
  const row = r.rows[0];
  if (!row) return;
  await tx.query(`INSERT INTO public.contact_versions (org_id, contact_id, revision, snapshot, created_by) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (contact_id, revision) DO NOTHING`, [row.org_id, contactId, row.version, JSON.stringify(row), userId]);
}

export async function masterRoutes(app: FastifyInstance): Promise<void> {
  // ---------- offices ----------
  app.get('/api/offices', async (req, reply) => {
    const actor = requireActor(req);
    const rows = await withUserTx(actor, (tx) => tx.query<Row>('SELECT * FROM public.office_profiles WHERE org_id = $1 ORDER BY revision DESC', [actor.orgId]).then((r) => r.rows));
    return ok(req, reply, rows.map(officeOut));
  });

  app.post('/api/offices', async (req, reply) => {
    const actor = requireActor(req);
    const body = parseOrThrow(OfficeProfileInputSchema, req.body);
    const row = await withUserTx(actor, async (tx) => {
      await tx.query('UPDATE public.office_profiles SET is_current = false WHERE org_id = $1 AND is_current', [actor.orgId]);
      const rev = await tx.query<{ n: number }>('SELECT COALESCE(max(revision), 0) + 1 AS n FROM public.office_profiles WHERE org_id = $1', [actor.orgId]);
      const r = await tx.query<Row>(
        `INSERT INTO public.office_profiles (org_id, revision, name_raw, address_raw, postcode_raw, phone_raw, fax_raw, email_raw, signature_settings, honorific_settings, is_current, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, true, $11) RETURNING *`,
        [actor.orgId, rev.rows[0]!.n, body.nameRaw, body.addressRaw, body.postcodeRaw, body.phoneRaw, body.faxRaw, body.emailRaw, JSON.stringify(body.signatureSettings), JSON.stringify(body.honorificSettings), actor.userId],
      );
      await audit(tx, actor, { action: 'office.revision_created', targetType: 'office_profile', targetId: r.rows[0]!.id as string, targetVersion: r.rows[0]!.revision as number });
      return r.rows[0]!;
    });
    return ok(req, reply, officeOut(row), {}, 201);
  });

  // 更新 = 新 revision を作成（既存 revision は変更しない。確定版・過去出力は変化しない）
  app.put('/api/offices/:id', async (req, reply) => {
    const actor = requireActor(req);
    const { id } = req.params as { id: string };
    const body = parseOrThrow(OfficeProfileUpdateSchema, req.body);
    const row = await withUserTx(actor, async (tx) => {
      const cur = await tx.query<Row>('SELECT * FROM public.office_profiles WHERE id = $1 AND org_id = $2 FOR UPDATE', [id, actor.orgId]);
      const c = cur.rows[0];
      if (!c) throw notFound();
      if ((c.version as number) !== body.expectedVersion) throw versionConflict(c.version as number);
      await tx.query('UPDATE public.office_profiles SET is_current = false WHERE org_id = $1 AND is_current', [actor.orgId]);
      const rev = await tx.query<{ n: number }>('SELECT COALESCE(max(revision), 0) + 1 AS n FROM public.office_profiles WHERE org_id = $1', [actor.orgId]);
      const r = await tx.query<Row>(
        `INSERT INTO public.office_profiles (org_id, revision, name_raw, address_raw, postcode_raw, phone_raw, fax_raw, email_raw, signature_settings, honorific_settings, is_current, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, true, $11) RETURNING *`,
        [actor.orgId, rev.rows[0]!.n, body.nameRaw, body.addressRaw, body.postcodeRaw, body.phoneRaw, body.faxRaw, body.emailRaw, JSON.stringify(body.signatureSettings), JSON.stringify(body.honorificSettings), actor.userId],
      );
      await audit(tx, actor, { action: 'office.revision_created', targetType: 'office_profile', targetId: r.rows[0]!.id as string, targetVersion: r.rows[0]!.revision as number, details: { supersedes: id } });
      return r.rows[0]!;
    });
    return ok(req, reply, officeOut(row));
  });

  // ---------- lawyers ----------
  app.get('/api/lawyers', async (req, reply) => {
    const actor = requireActor(req);
    const rows = await withUserTx(actor, (tx) => tx.query<Row>('SELECT * FROM public.lawyers WHERE org_id = $1 ORDER BY active DESC, created_at', [actor.orgId]).then((r) => r.rows));
    return ok(req, reply, rows.map(lawyerOut));
  });
  app.post('/api/lawyers', { config: { auth: { roles: ['admin', 'lawyer'] } } }, async (req, reply) => {
    const actor = requireActor(req);
    const body = parseOrThrow(LawyerInputSchema, req.body);
    const row = await withUserTx(actor, async (tx) => {
      const r = await tx.query<Row>(
        `INSERT INTO public.lawyers (org_id, user_id, name_raw, kana, office_profile_id, title_raw, registration_number_raw, active, search_key, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
        [actor.orgId, body.userId ?? null, body.nameRaw, body.kana, body.officeProfileId ?? null, body.titleRaw, body.registrationNumberRaw, body.active, buildSearchKey(`${body.nameRaw} ${body.kana}`).key, actor.userId],
      );
      await audit(tx, actor, { action: 'lawyer.created', targetType: 'lawyer', targetId: r.rows[0]!.id as string, targetVersion: 1 });
      return r.rows[0]!;
    });
    return ok(req, reply, lawyerOut(row), {}, 201);
  });
  app.put('/api/lawyers/:id', { config: { auth: { roles: ['admin', 'lawyer'] } } }, async (req, reply) => {
    const actor = requireActor(req);
    const { id } = req.params as { id: string };
    const body = parseOrThrow(LawyerUpdateSchema, req.body);
    const row = await withUserTx(actor, async (tx) => {
      const cur = await tx.query<Row>('SELECT * FROM public.lawyers WHERE id = $1 AND org_id = $2 FOR UPDATE', [id, actor.orgId]);
      const c = cur.rows[0];
      if (!c) throw notFound();
      if ((c.version as number) !== body.expectedVersion) throw versionConflict(c.version as number);
      const next = { nameRaw: body.nameRaw ?? (c.name_raw as string), kana: body.kana ?? (c.kana as string), titleRaw: body.titleRaw ?? (c.title_raw as string), registrationNumberRaw: body.registrationNumberRaw ?? (c.registration_number_raw as string), userId: body.userId === undefined ? (c.user_id as string | null) : body.userId, officeProfileId: body.officeProfileId === undefined ? (c.office_profile_id as string | null) : body.officeProfileId, active: body.active ?? (c.active as boolean) };
      const r = await tx.query<Row>(
        `UPDATE public.lawyers SET name_raw = $3, kana = $4, title_raw = $5, registration_number_raw = $6, user_id = $7, office_profile_id = $8, active = $9, search_key = $10 WHERE id = $1 AND version = $2 RETURNING *`,
        [id, body.expectedVersion, next.nameRaw, next.kana, next.titleRaw, next.registrationNumberRaw, next.userId, next.officeProfileId, next.active, buildSearchKey(`${next.nameRaw} ${next.kana}`).key],
      );
      if (!r.rows[0]) throw versionConflict((c.version as number) + 1);
      await audit(tx, actor, { action: 'lawyer.updated', targetType: 'lawyer', targetId: id, targetVersion: r.rows[0].version as number });
      return r.rows[0];
    });
    return ok(req, reply, lawyerOut(row));
  });

  // ---------- contacts ----------
  app.get('/api/contacts', async (req, reply) => {
    const actor = requireActor(req);
    const q = parseOrThrow(ContactSearchQuerySchema, req.query);
    const cur = decodeCursor<{ n: string; id: string }>(q.cursor);
    const { rows, aliasHits } = await withUserTx(actor, async (tx) => {
      const params: unknown[] = [actor.orgId, q.limit + 1];
      let where = 'c.org_id = $1';
      if (q.type) {
        params.push(q.type);
        where += ` AND c.type = $${params.length}`;
      }
      let aliasJoin = '';
      if (q.q) {
        if (q.mode === 'exact') {
          params.push(`%${q.q.replace(/[%_\\]/g, (ch) => '\\' + ch)}%`);
          where += ` AND (c.name_raw LIKE $${params.length} OR c.organization_name_raw LIKE $${params.length} OR c.kana LIKE $${params.length})`;
        } else {
          const key = buildSearchKey(q.q).key.replace(/[%_\\]/g, (ch) => '\\' + ch);
          params.push(`%${key}%`, `%${key.replace(/ /g, '')}%`);
          aliasJoin = `LEFT JOIN public.contact_aliases al ON al.contact_id = c.id AND (al.search_key LIKE $${params.length - 1} OR replace(al.search_key, ' ', '') LIKE $${params.length})`;
          where += ` AND (c.search_key LIKE $${params.length - 1} OR replace(c.search_key, ' ', '') LIKE $${params.length} OR al.id IS NOT NULL)`;
        }
      }
      if (cur) {
        params.push(cur.n, cur.id);
        where += ` AND (c.name_raw, c.id) > ($${params.length - 1}, $${params.length}::uuid)`;
      }
      const r = await tx.query<Row & { alias_hit: string | null }>(`SELECT DISTINCT ON (c.name_raw, c.id) c.*, ${aliasJoin ? 'al.alias_raw' : 'NULL::text'} AS alias_hit FROM public.contacts c ${aliasJoin} WHERE ${where} ORDER BY c.name_raw, c.id LIMIT $2`, params);
      const ids = r.rows.map((x) => x.id as string);
      const aliases = ids.length ? await tx.query<{ id: string; contact_id: string; alias_raw: string }>('SELECT id, contact_id, alias_raw FROM public.contact_aliases WHERE contact_id = ANY($1::uuid[])', [ids]) : { rows: [] as Array<{ id: string; contact_id: string; alias_raw: string }> };
      return { rows: r.rows, aliasHits: aliases.rows };
    });
    const page = rows.slice(0, q.limit);
    const last = page[page.length - 1];
    const nextCursor = rows.length > q.limit && last ? encodeCursor({ n: last.name_raw as string, id: last.id as string }) : null;
    const out = page.map((r) => {
      const c = contactOut(r, aliasHits.filter((a) => a.contact_id === r.id));
      if (q.q) c.matchReason = r.alias_hit ? 'alias' : `${c.nameRaw} ${c.organizationNameRaw} ${c.kana}`.includes(q.q) ? 'exact' : 'normalized';
      return c;
    });
    return ok(req, reply, out, { nextCursor });
  });

  app.get('/api/contacts/:id', async (req, reply) => {
    const actor = requireActor(req);
    const { id } = req.params as { id: string };
    const c = await withUserTx(actor, (tx) => loadContact(tx, id));
    return ok(req, reply, c);
  });

  app.post('/api/contacts', async (req, reply) => {
    const actor = requireActor(req);
    const body = parseOrThrow(ContactInputSchema, req.body);
    const out = await withUserTx(actor, async (tx) => {
      const key = contactSearchKey(body);
      const r = await tx.query<Row>(
        `INSERT INTO public.contacts (org_id, type, name_raw, kana, organization_name_raw, address_raw, postcode_raw, channels_json, external_id, checked_at, search_key, notes_raw, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING *`,
        [actor.orgId, body.type, body.nameRaw, body.kana, body.organizationNameRaw, body.addressRaw, body.postcodeRaw, JSON.stringify(body.channels), body.externalId ?? null, body.checkedAt ?? null, key, body.notesRaw, actor.userId],
      );
      const row = r.rows[0]!;
      await snapshotContact(tx, row.id as string, actor.userId);
      // 類似名は提案のみ（自動 merge 禁止）
      const nameKey = buildSearchKey(body.nameRaw).key;
      const similar = await tx.query<{ id: string }>(`SELECT id FROM public.contacts WHERE org_id = $1 AND id <> $2 AND search_key LIKE $3 LIMIT 10`, [actor.orgId, row.id, `%${nameKey.replace(/[%_\\]/g, (ch) => '\\' + ch)}%`]);
      await audit(tx, actor, { action: 'contact.created', targetType: 'contact', targetId: row.id as string, targetVersion: 1 });
      const c = contactOut(row);
      c.similarIds = similar.rows.map((s) => s.id);
      return c;
    });
    return ok(req, reply, out, {}, 201);
  });

  app.put('/api/contacts/:id', async (req, reply) => {
    const actor = requireActor(req);
    const { id } = req.params as { id: string };
    const body = parseOrThrow(ContactUpdateSchema, req.body);
    const out = await withUserTx(actor, async (tx) => {
      const cur = await tx.query<Row>('SELECT * FROM public.contacts WHERE id = $1 AND org_id = $2 FOR UPDATE', [id, actor.orgId]);
      const c = cur.rows[0];
      if (!c) throw notFound();
      if ((c.version as number) !== body.expectedVersion) throw versionConflict(c.version as number);
      const next = {
        type: body.type ?? (c.type as string), nameRaw: body.nameRaw ?? (c.name_raw as string), kana: body.kana ?? (c.kana as string), organizationNameRaw: body.organizationNameRaw ?? (c.organization_name_raw as string), addressRaw: body.addressRaw ?? (c.address_raw as string), postcodeRaw: body.postcodeRaw ?? (c.postcode_raw as string),
        channels: body.channels ?? (c.channels_json as Record<string, unknown>), externalId: body.externalId === undefined ? (c.external_id as string | null) : body.externalId, checkedAt: body.checkedAt === undefined ? (c.checked_at as string | null) : body.checkedAt, notesRaw: body.notesRaw ?? (c.notes_raw as string),
      };
      const r = await tx.query<Row>(
        `UPDATE public.contacts SET type = $3, name_raw = $4, kana = $5, organization_name_raw = $6, address_raw = $7, postcode_raw = $8, channels_json = $9, external_id = $10, checked_at = $11, notes_raw = $12, search_key = $13 WHERE id = $1 AND version = $2 RETURNING *`,
        [id, body.expectedVersion, next.type, next.nameRaw, next.kana, next.organizationNameRaw, next.addressRaw, next.postcodeRaw, JSON.stringify(next.channels), next.externalId, next.checkedAt, next.notesRaw, contactSearchKey(next)],
      );
      if (!r.rows[0]) throw versionConflict((c.version as number) + 1);
      await snapshotContact(tx, id, actor.userId);
      await audit(tx, actor, { action: 'contact.updated', targetType: 'contact', targetId: id, targetVersion: r.rows[0].version as number });
      return loadContact(tx, id);
    });
    return ok(req, reply, out);
  });

  app.post('/api/contacts/:id/aliases', async (req, reply) => {
    const actor = requireActor(req);
    const { id } = req.params as { id: string };
    const body = parseOrThrow(z.object({ aliasRaw: z.string().min(1).max(200) }), req.body);
    const out = await withUserTx(actor, async (tx) => {
      const c = await tx.query<{ org_id: string }>('SELECT org_id FROM public.contacts WHERE id = $1', [id]);
      if (!c.rows[0]) throw notFound();
      await tx.query('INSERT INTO public.contact_aliases (org_id, contact_id, alias_raw, search_key, created_by) VALUES ($1, $2, $3, $4, $5)', [c.rows[0].org_id, id, body.aliasRaw, buildSearchKey(body.aliasRaw).key, actor.userId]);
      await audit(tx, actor, { action: 'contact.alias_added', targetType: 'contact', targetId: id });
      return loadContact(tx, id);
    });
    return ok(req, reply, out, {}, 201);
  });

  // ---------- members ----------
  const memberRows = async (tx: Tx, orgId: string): Promise<Member[]> => {
    const r = await tx.query<Row>(
      `SELECT m.user_id, m.role, m.status, m.version, u.display_name_raw, u.email_raw, l.id AS lawyer_id FROM public.memberships m JOIN public.app_users u ON u.id = m.user_id LEFT JOIN public.lawyers l ON l.org_id = m.org_id AND l.user_id = m.user_id WHERE m.org_id = $1 ORDER BY m.created_at`,
      [orgId],
    );
    const ids = r.rows.map((x) => x.user_id as string);
    const enrolled = await withServiceTx(async (stx) => {
      const e = await stx.query<{ user_id: string }>('SELECT user_id FROM private.mfa_totp WHERE enrolled_at IS NOT NULL AND user_id = ANY($1::uuid[])', [ids]);
      return new Set(e.rows.map((x) => x.user_id));
    });
    return r.rows.map((x) => ({ userId: x.user_id as string, displayName: x.display_name_raw as string, email: x.email_raw as string, role: x.role as Member['role'], status: x.status as Member['status'], lawyerId: (x.lawyer_id as string | null) ?? null, mfaEnrolled: enrolled.has(x.user_id as string), version: x.version as number }));
  };

  app.get('/api/members', async (req, reply) => {
    const actor = requireActor(req);
    const rows = await withUserTx(actor, (tx) => memberRows(tx, actor.orgId));
    return ok(req, reply, rows);
  });

  app.post('/api/members', { config: { auth: { roles: ['admin'], requireRecentMfa: true } } }, async (req, reply) => {
    const actor = requireActor(req);
    const body = parseOrThrow(MemberInviteSchema, req.body);
    const initialPassword = body.initialPassword ?? randomToken(12);
    const emailKey = body.email.trim().toLowerCase();
    const userId = await withServiceTx(async (tx) => {
      const existing = await tx.query<{ id: string }>('SELECT id FROM public.app_users WHERE email_key = $1', [emailKey]);
      let uid = existing.rows[0]?.id;
      if (!uid) {
        const r = await tx.query<{ id: string }>('INSERT INTO public.app_users (email_raw, email_key, display_name_raw) VALUES ($1, $2, $3) RETURNING id', [body.email, emailKey, body.displayNameRaw]);
        uid = r.rows[0]!.id;
        await tx.query('INSERT INTO private.local_credentials (user_id, password_hash, must_change) VALUES ($1, $2, true)', [uid, await hashPassword(initialPassword)]);
      }
      const dup = await tx.query('SELECT 1 FROM public.memberships WHERE org_id = $1 AND user_id = $2', [actor.orgId, uid]);
      if (dup.rowCount) throw conflict('既にメンバーです');
      await tx.query('INSERT INTO public.memberships (org_id, user_id, role, status, created_by) VALUES ($1, $2, $3, $4, $5)', [actor.orgId, uid, body.role, 'active', actor.userId]);
      // 初期 lawyer 指定はオンボーディング運用責任者が行い監査する
      await tx.query(`INSERT INTO public.audit_events (org_id, actor_id, actor_role, action, target_type, target_id, request_id, details) VALUES ($1, $2, $3, 'member.invited', 'membership', $4, $5, $6)`, [actor.orgId, actor.userId, actor.role, uid, actor.requestId, JSON.stringify({ role: body.role })]);
      return uid;
    });
    const rows = await withUserTx(actor, (tx) => memberRows(tx, actor.orgId));
    const m = rows.find((x) => x.userId === userId);
    if (!m) throw notFound();
    return ok(req, reply, { ...m, initialPassword: body.initialPassword ? undefined : initialPassword }, {}, 201);
  });

  app.put('/api/members/:userId', { config: { auth: { roles: ['admin'], requireRecentMfa: true } } }, async (req, reply) => {
    const actor = requireActor(req);
    const { userId } = req.params as { userId: string };
    const body = parseOrThrow(z.object({ role: z.enum(['admin', 'lawyer', 'staff']).optional(), status: z.enum(['active', 'suspended', 'left']).optional(), expectedVersion: z.number().int() }), req.body);
    if (userId === actor.userId && body.role && body.role !== 'admin') throw forbidden('自分自身の admin 権限は変更できません');
    await withUserTx(actor, async (tx) => {
      try {
        const r = await tx.query<{ version: number }>(
          `UPDATE public.memberships SET role = COALESCE($3, role), status = COALESCE($4, status) WHERE org_id = $1 AND user_id = $2 AND version = $5 RETURNING version`,
          [actor.orgId, userId, body.role ?? null, body.status ?? null, body.expectedVersion],
        );
        if (!r.rows[0]) {
          const cur = await tx.query<{ version: number }>('SELECT version FROM public.memberships WHERE org_id = $1 AND user_id = $2', [actor.orgId, userId]);
          if (!cur.rows[0]) throw notFound();
          throw versionConflict(cur.rows[0].version);
        }
      } catch (e) {
        if ((e as { message?: string }).message?.includes('last_admin_cannot_be_removed')) throw new ApiError(409, 'conflict', '最後の admin は削除・降格できません');
        throw e;
      }
      await audit(tx, actor, { action: 'member.updated', targetType: 'membership', targetId: userId, details: { role: body.role, status: body.status } });
    });
    if (body.status && body.status !== 'active') {
      const { revokeAllUserSessions } = await import('../auth/session.js');
      await revokeAllUserSessions(userId);
    }
    const rows = await withUserTx(actor, (tx) => memberRows(tx, actor.orgId));
    return ok(req, reply, rows.find((x) => x.userId === userId) ?? null);
  });
}
