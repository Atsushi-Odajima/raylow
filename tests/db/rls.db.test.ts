import { beforeAll, describe, expect, it } from 'vitest';
import { seedCreds, sql } from '../helpers/api.js';

/** RLS / 制約の DB レベル検証（AC14/AC17/AC18/AC27 の DB 側） */
let ids: ReturnType<typeof seedCreds>['ids'];
const users: Record<string, string> = {};

async function asUser(userKey: string, text: string, params: unknown[] = []) {
  const { withUserTx } = await import('../../apps/api/src/db/pool.js');
  return withUserTx({ userId: users[userKey]!, orgId: '', role: 'lawyer', requestId: 't' }, async (tx) => (await tx.query(text, params)).rows);
}

beforeAll(async () => {
  const creds = seedCreds();
  ids = creds.ids;
  for (const u of creds.users) {
    const r = await sql<{ id: string }>('SELECT id FROM public.app_users WHERE email_key = $1', [u.email.toLowerCase()]);
    users[u.key] = r[0]!.id;
  }
});

describe('RLS: org / matter / barrier 境界', () => {
  it('他 org の案件は本文も件数も見えない', async () => {
    const rows = await asUser('minato_lawyer', 'SELECT id FROM public.matters WHERE org_id = $1', [ids.orgs.aoba]);
    expect(rows).toHaveLength(0);
    const cnt = await asUser('minato_lawyer', 'SELECT count(*)::int AS n FROM public.contacts WHERE org_id = $1', [ids.orgs.aoba]);
    expect((cnt[0] as { n: number }).n).toBe(0);
  });
  it('barrier のユーザーは当該案件を取得できない（member でも）', async () => {
    const a = await asUser('lawyerA', 'SELECT id FROM public.matters WHERE id = $1', [ids.matters.m2]);
    expect(a).toHaveLength(1);
    const b = await asUser('lawyerB', 'SELECT id FROM public.matters WHERE id = $1', [ids.matters.m2]);
    expect(b).toHaveLength(0);
    const parties = await asUser('lawyerB', 'SELECT id FROM public.matter_parties WHERE matter_id = $1', [ids.matters.m2]);
    expect(parties).toHaveLength(0);
  });
  it('admin は事件本文の全件閲覧権を持たない（未割当案件は 0 行）', async () => {
    const r = await asUser('aoba_admin', 'SELECT id FROM public.matters');
    expect(r).toHaveLength(0);
  });
  it('未割当の同 org lawyer は案件を見られない', async () => {
    await sql('DELETE FROM public.matter_members WHERE matter_id = $1 AND user_id = $2', [ids.matters.m3, users.lawyerA]);
    const r = await asUser('lawyerA', 'SELECT id FROM public.matters WHERE id = $1', [ids.matters.m3]);
    expect(r).toHaveLength(0);
    await sql('INSERT INTO public.matter_members (matter_id, user_id, org_id, can_edit) VALUES ($1, $2, $3, true)', [ids.matters.m3, users.lawyerA, ids.orgs.aoba]);
  });
  it('cross-org 参照は trigger で拒否される', async () => {
    const minatoContact = await sql<{ id: string }>('SELECT id FROM public.contacts WHERE org_id = $1 LIMIT 1', [ids.orgs.minato]);
    await expect(sql('INSERT INTO public.matter_parties (org_id, matter_id, contact_id, role) VALUES ($1, $2, $3, $4)', [ids.orgs.aoba, ids.matters.m1, minatoContact[0]!.id, 'third_party'])).rejects.toThrow(/cross_org_reference/);
  });
});

describe('不変条件トリガー', () => {
  it('audit_events は UPDATE/DELETE できない（service_role でも）', async () => {
    const ev = await sql<{ id: string }>('SELECT id FROM public.audit_events LIMIT 1');
    // GRANT で UPDATE/DELETE が無く（permission denied）、さらに trigger（immutable_row）でも止まる
    await expect(sql('UPDATE public.audit_events SET action = $2 WHERE id = $1', [ev[0]!.id, 'tampered'])).rejects.toThrow(/immutable_row|permission denied/);
    await expect(sql('DELETE FROM public.audit_events WHERE id = $1', [ev[0]!.id])).rejects.toThrow(/immutable_row|permission denied/);
    // superuser 相当（migration owner）でも trigger が止める
    const pg = (await import('pg')).default;
    const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await c.connect();
    await expect(c.query('DELETE FROM public.audit_events WHERE id = $1', [ev[0]!.id])).rejects.toThrow(/immutable_row/);
    await c.end();
  });
  it('published 書式版の schema/docx は変更できない', async () => {
    const tv = await sql<{ id: string }>(`SELECT id FROM public.template_versions WHERE status = 'published' LIMIT 1`);
    await expect(sql(`UPDATE public.template_versions SET field_schema = '{}'::jsonb WHERE id = $1`, [tv[0]!.id])).rejects.toThrow(/published_template_version_immutable/);
    await expect(sql(`UPDATE public.template_versions SET status = 'draft' WHERE id = $1`, [tv[0]!.id])).rejects.toThrow(/published_template_version_immutable/);
  });
  it('最後の admin は削除できない', async () => {
    await expect(sql(`DELETE FROM public.memberships WHERE org_id = $1 AND role = 'admin'`, [ids.orgs.minato])).rejects.toThrow(/last_admin_cannot_be_removed/);
  });
  it('同じ案件の確定証拠番号は一意', async () => {
    await expect(sql(`INSERT INTO public.evidence (org_id, matter_id, symbol_raw, number_raw, canonical_number, display_label, status) VALUES ($1, $2, '甲', '１', '甲:1', '甲第１号証', 'confirmed')`, [ids.orgs.aoba, ids.matters.m1])).rejects.toThrow(/duplicate key/);
    // draft なら重複可（確定時に検査）
    const r = await sql<{ id: string }>(`INSERT INTO public.evidence (org_id, matter_id, symbol_raw, number_raw, canonical_number, display_label, status) VALUES ($1, $2, '甲', '１', '甲:1', '甲第１号証', 'draft') RETURNING id`, [ids.orgs.aoba, ids.matters.m1]);
    expect(r[0]!.id).toBeTruthy();
    await sql('DELETE FROM public.evidence WHERE id = $1', [r[0]!.id]);
  });
  it('version は UPDATE で自動増分し、expectedVersion 不一致を検出できる', async () => {
    const c = await sql<{ id: string; version: number }>('SELECT id, version FROM public.contacts WHERE org_id = $1 LIMIT 1', [ids.orgs.aoba]);
    const before = c[0]!.version;
    const upd = await sql<{ version: number }>('UPDATE public.contacts SET notes_raw = $2 WHERE id = $1 AND version = $3 RETURNING version', [c[0]!.id, 'メモ', before]);
    expect(upd[0]!.version).toBe(before + 1);
    const stale = await sql('UPDATE public.contacts SET notes_raw = $2 WHERE id = $1 AND version = $3 RETURNING version', [c[0]!.id, 'x', before]);
    expect(stale).toHaveLength(0);
  });
  it('job claim は SKIP LOCKED で重複取得しない', async () => {
    const org = ids.orgs.aoba;
    await sql(`INSERT INTO public.jobs (org_id, type, scope_key, input_hash, payload) VALUES ($1, 'noop_test', 'x', 'h1', '{}')`, [org]);
    const a = await sql<{ id: string }>(`SELECT id FROM app.claim_job('w1', ARRAY['noop_test'], 120)`);
    const b = await sql<{ id: string }>(`SELECT id FROM app.claim_job('w2', ARRAY['noop_test'], 120)`);
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(0);
    await sql(`DELETE FROM public.jobs WHERE type = 'noop_test'`);
  });
  it('同一 input_hash の active job は重複投入できない', async () => {
    const org = ids.orgs.aoba;
    await sql(`INSERT INTO public.jobs (org_id, type, scope_key, input_hash, payload) VALUES ($1, 'dedupe_test', 's', 'same', '{}')`, [org]);
    await expect(sql(`INSERT INTO public.jobs (org_id, type, scope_key, input_hash, payload) VALUES ($1, 'dedupe_test', 's', 'same', '{}')`, [org])).rejects.toThrow(/duplicate key/);
    await sql(`DELETE FROM public.jobs WHERE type = 'dedupe_test'`);
  });
});
