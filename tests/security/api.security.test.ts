/** AC06/AC12/AC14/AC18/AC20/AC23 のセキュリティ検証（API in-process） */
import fs from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { TEST_ROOT } from '../helpers/env.js';
import { ApiClient, getApp, loginAs, seedCreds, sql, waitJob } from '../helpers/api.js';

let A: ApiClient;
let B: ApiClient;
let M: ApiClient;
let S: ApiClient;
let ids: ReturnType<typeof seedCreds>['ids'];

beforeAll(async () => {
  ids = seedCreds().ids;
  A = await loginAs('lawyerA');
  B = await loginAs('lawyerB');
  M = await loginAs('minato_lawyer');
  S = await loginAs('staff');
});

describe('認証・CSRF・Origin', () => {
  it('未認証は 401、MFA 未完了は mfa_required', async () => {
    const anon = new ApiClient(await getApp());
    expect((await anon.call('GET', '/api/matters')).status).toBe(401);
    const u = seedCreds().users.find((x) => x.key === 'lawyerA')!;
    const half = new ApiClient(await getApp());
    await half.call('POST', '/api/auth/login', { email: u.email, password: u.password });
    const r = await half.call('GET', '/api/matters');
    expect(r.status).toBe(401);
    expect(r.error?.code).toBe('mfa_required');
  });
  it('誤パスワードは 401 で存在を漏らさない', async () => {
    const c = new ApiClient(await getApp());
    const r1 = await c.call('POST', '/api/auth/login', { email: 'nobody@aoba.example', password: 'x' });
    const r2 = await c.call('POST', '/api/auth/login', { email: 'hanako@aoba.example', password: 'wrong' });
    expect(r1.status).toBe(401);
    expect(r2.status).toBe(401);
    expect(r1.error?.message).toBe(r2.error?.message);
  });
  it('CSRF token 無し / Origin 不一致の変更要求は 403', async () => {
    const c = new ApiClient(await getApp());
    await c.login('lawyerA');
    const saved = c.csrf;
    c.csrf = '';
    expect((await c.call('POST', '/api/contacts', { type: 'person', nameRaw: 'x' })).error?.code).toBe('csrf_failed');
    c.csrf = saved;
    const bad = new ApiClient(await getApp(), 'https://evil.example');
    bad.cookie = c.cookie;
    bad.csrf = c.csrf;
    expect((await bad.call('POST', '/api/contacts', { type: 'person', nameRaw: 'x' })).error?.code).toBe('origin_not_allowed');
  });
  it('API 応答は no-store', async () => {
    const r = await A.raw('GET', '/api/matters');
    expect(r.headers['cache-control']).toBe('no-store');
  });
  it('ログアウト後は session が無効', async () => {
    const c = await loginAs('staff');
    await c.call('POST', '/api/auth/logout');
    expect((await c.call('GET', '/api/matters')).status).toBe(401);
  });
});

describe('AC18: 越境は本文だけでなく候補数・preview・job・file・export・audit も 404/0 件', () => {
  it('他 org の案件/草案/job/監査', async () => {
    expect((await M.call('GET', `/api/matters/${ids.matters.m1}`)).status).toBe(404);
    const docs = await M.expectOk<unknown[]>('GET', `/api/documents?matterId=${ids.matters.m1}`);
    expect(docs).toHaveLength(0);
    const ev = await M.call('GET', `/api/matters/${ids.matters.m1}/evidence`);
    expect(ev.status).toBe(404);
    const audit = await M.expectOk<unknown[]>('GET', `/api/audit?matterId=${ids.matters.m1}`);
    expect(audit).toHaveLength(0);
    const search = await M.expectOk<{ contacts: unknown[]; matters: unknown[] }>('GET', '/api/search?q=ミドリ');
    expect(search.contacts).toHaveLength(0);
    expect(search.matters).toHaveLength(0);
    const exp = await M.call('POST', '/api/exports', { type: 'matter_json', matterId: ids.matters.m1 });
    expect(exp.status).toBe(404);
  });
  it('barrier ユーザー（lawyerB）は m2 を取得できず、草案も作れない', async () => {
    expect((await B.call('GET', `/api/matters/${ids.matters.m2}`)).status).toBe(404);
    const t = await B.expectOk<Array<{ activeVersion: { id: string } }>>('GET', '/api/templates?kind=T08_cover_letter');
    const d = await B.call('POST', '/api/drafts', { matterId: ids.matters.m2, templateVersionId: t[0]!.activeVersion.id, recipientType: 'client', recipientContactId: ids.contacts.yamada, idempotencyKey: 'barrier-test-1' });
    expect(d.status).toBe(404);
    const list = await B.expectOk<Array<{ id: string }>>('GET', '/api/matters');
    expect(list.map((m) => m.id)).not.toContain(ids.matters.m2);
  });
  it('他 org のファイル/出力は 404', async () => {
    const f = await sql<{ id: string }>('SELECT id FROM public.files WHERE org_id = $1 LIMIT 1', [ids.orgs.aoba]);
    expect((await M.call('GET', `/api/files/${f[0]!.id}`)).status).toBe(404);
    expect((await M.raw('GET', `/api/files/${f[0]!.id}/content`)).statusCode).toBe(404);
    const j = await sql<{ id: string }>('SELECT id FROM public.jobs WHERE org_id = $1 LIMIT 1', [ids.orgs.aoba]);
    if (j[0]) expect((await M.call('GET', `/api/jobs/${j[0].id}`)).status).toBe(404);
  });
});

describe('AC12: 一括生成の上限と宛先混入防止', () => {
  it('100 件超は 422', async () => {
    const tvs = await A.expectOk<Array<{ activeVersion: { id: string } }>>('GET', '/api/templates');
    const ids20 = tvs.slice(0, 20).map((t) => t.activeVersion.id);
    const recipients = Array.from({ length: 6 }, () => ({ type: 'client', contactId: ids.contacts.midori }));
    const r = await A.call('POST', '/api/batches', { matterId: ids.matters.m1, templateVersionIds: ids20, recipients, idempotencyKey: 'batch-limit-test' });
    expect(r.status).toBe(422);
    expect(r.error?.code).toBe('batch_limit_exceeded');
  });
  it('宛先ごとに独立 snapshot（A の書面に B の情報が混入しない）', async () => {
    const t = await A.expectOk<Array<{ activeVersion: { id: string } }>>('GET', '/api/templates?kind=T08_cover_letter');
    const r = await A.call<{ id: string; items: Array<{ id: string; draftId: string; status: string }> }>('POST', '/api/batches', { matterId: ids.matters.m1, templateVersionIds: [t[0]!.activeVersion.id], recipients: [{ type: 'client', contactId: ids.contacts.midori }, { type: 'opponent_agent', contactId: ids.contacts.sato1 }], idempotencyKey: 'batch-mix-test' });
    expect(r.status, JSON.stringify(r.json)).toBe(202);
    const { drainJobs } = await import('../helpers/api.js');
    await drainJobs();
    const b = await A.expectOk<{ status: string; items: Array<{ draftId: string; status: string; errorMessage: string | null }> }>('GET', `/api/batches/${r.data.id}`);
    const names: string[] = [];
    for (const it of b.items) {
      const d = await A.expectOk<{ currentRevision: { snapshot: { recipient: { nameRaw: string }; fields: Record<string, { rawValue: unknown }> } } }>('GET', `/api/drafts/${it.draftId}`);
      names.push(d.currentRevision.snapshot.recipient.nameRaw);
      expect(String(d.currentRevision.snapshot.fields.recipient_name?.rawValue ?? d.currentRevision.snapshot.recipient.nameRaw)).toBe(d.currentRevision.snapshot.recipient.nameRaw);
    }
    expect(names.sort()).toEqual(['佐藤 一郎', '株式会社ミドリ商事']);
    expect(b.items.every((i) => i.status === 'succeeded'), JSON.stringify(b.items)).toBe(true);
  });
});

describe('AC20/AC06: 危険ファイルと書式の拒否', () => {
  const forbidden = path.join(TEST_ROOT, 'tests', 'fixtures', 'docx', 'forbidden');
  async function importDocx(file: string, name: string) {
    const bytes = fs.readFileSync(file);
    const boundary = '----raylowsec' + Date.now();
    const body = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="fields"\r\n\r\n${JSON.stringify({ name, kind: 'custom' })}\r\n`), Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${path.basename(file)}"\r\nContent-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document\r\n\r\n`), bytes, Buffer.from(`\r\n--${boundary}--\r\n`)]);
    return A.raw('POST', '/api/templates/import', undefined, { 'content-type': `multipart/form-data; boundary=${boundary}` }, body);
  }
  it('DOCM は登録時に 415', async () => {
    const r = await importDocx(path.join(forbidden, 'macro_enabled.docm'), 'macro');
    expect(r.statusCode).toBe(415);
  });
  it('偽 MIME（PNG を .docx）は 415', async () => {
    const r = await importDocx(path.join(TEST_ROOT, 'tests', 'fixtures', 'docx', 'fake_mime.docx'), 'fake');
    expect(r.statusCode).toBe(415);
  });
  it('ZIP bomb / 対応外要素は検査 job で拒否され位置が示される', async () => {
    const cases: Array<[string, string]> = [['zip_bomb.docx', 'compression_ratio'], ['forbidden/with_textbox.docx', 'textbox'], ['forbidden/with_comments.docx', 'comments'], ['forbidden/with_tracked_changes.docx', 'tracked_changes'], ['forbidden/with_multiple_sections.docx', 'multiple_sections'], ['forbidden/with_external_rel.docx', 'external_relationship'], ['forbidden/with_ole.docx', 'ole_object'], ['forbidden/with_unsupported_field.docx', 'unsupported_field'], ['forbidden/with_vmerge_in_loop.docx', 'vmerge_in_loop'], ['forbidden/with_paragraph_spanning_tag.docx', 'paragraph_spanning_tag'], ['forbidden/with_unbalanced_loop.docx', 'unbalanced_loop'], ['forbidden/with_dot_tag.docx', 'dot_path_not_allowed'], ['forbidden/with_dangerous_key.docx', 'dangerous_key'], ['forbidden/with_expression_tag.docx', 'expression_not_allowed'], ['forbidden/with_footnotes.docx', 'footnotes']];
    for (const [file, code] of cases) {
      const r = await importDocx(path.join(TEST_ROOT, 'tests', 'fixtures', 'docx', file), `sec-${code}`);
      expect(r.statusCode, `${file}: ${r.body}`).toBe(202);
      const j = (r.json() as { data: { jobId: string; versionId: string } }).data;
      const job = await waitJob(A, j.jobId);
      expect(job.state, file).toBe('succeeded');
      expect((job.result as { rejected: boolean }).rejected, file).toBe(true);
      const v = await A.expectOk<{ inspectionReport: { issues: Array<{ code: string; location?: string; severity: string }> } }>('GET', `/api/template-versions/${j.versionId}`);
      const hit = v.inspectionReport.issues.find((i) => i.code === code && i.severity === 'error');
      expect(hit, `${file} expected ${code}, got ${JSON.stringify(v.inspectionReport.issues.map((i) => i.code))}`).toBeTruthy();
      expect(hit!.location, `${file} location`).toBeTruthy();
    }
  });
  it('スキーマに危険キー/未定義タグ/循環があれば保存不可（AC06）', async () => {
    const r = await importDocx(path.join(forbidden, 'clean_minimal.docx'), 'clean');
    const j = (r.json() as { data: { jobId: string; versionId: string } }).data;
    expect((await waitJob(A, j.jobId)).state).toBe('succeeded');
    const v = await A.expectOk<{ version: number }>('GET', `/api/template-versions/${j.versionId}`);
    const base = { schemaVersion: 1, kind: 'custom', title: 'x', scope: 'negotiation', recipientTypes: ['client'], bodyTag: 'body_text', attachments: false, honorificKeys: [] };
    const dangerous = await A.call('PUT', `/api/template-versions/${j.versionId}/schema`, { expectedVersion: v.version, fieldSchema: { ...base, fields: [{ key: '__proto__', type: 'text', label: 'x' }] }, tagMap: {} });
    expect(dangerous.status).toBe(422);
    const cyc = await A.call('PUT', `/api/template-versions/${j.versionId}/schema`, { expectedVersion: v.version, fieldSchema: { ...base, fields: [{ key: 'a', type: 'text', label: 'a', visibilityRule: { op: 'isPresent', field: 'b' } }, { key: 'b', type: 'text', label: 'b', visibilityRule: { op: 'isPresent', field: 'a' } }] }, tagMap: {} });
    expect(cyc.status).toBe(422);
  });
  it('タグに XML/JS 文字列を入れても実行されずエスケープされる', async () => {
    const t = await A.expectOk<Array<{ activeVersion: { id: string } }>>('GET', '/api/templates?kind=T08_cover_letter');
    const d = await A.expectOk<{ draft: { id: string; version: number }; currentRevision: { snapshot: { fields: Record<string, unknown> } } }>('POST', '/api/drafts', { matterId: ids.matters.m1, templateVersionId: t[0]!.activeVersion.id, recipientType: 'client', recipientContactId: ids.contacts.midori, idempotencyKey: 'xss-test-1' });
    const fields = { ...d.currentRevision.snapshot.fields, subject: { rawValue: '<w:p><script>alert(1)</script>{office_name}{#x}' } };
    const saved = await A.expectOk<{ draft: { version: number } }>('PUT', `/api/drafts/${d.draft.id}/revisions`, { expectedVersion: d.draft.version, fields, ast: { schemaVersion: 1, blocks: [{ id: 'b1', type: 'paragraph', text: '</w:t></w:r><w:r><w:t>INJECT' }] }, attachments: [] });
    expect(saved.draft.version).toBeGreaterThan(d.draft.version);
    const r = await A.expectOk<{ jobId: string }>('POST', `/api/drafts/${d.draft.id}/render`, { mode: 'draft' });
    const job = await waitJob(A, r.jobId);
    expect(job.state, JSON.stringify(job)).toBe('succeeded');
    const out = await A.expectOk<{ outputs: Array<{ id: string; format: string }> }>('GET', `/api/drafts/${d.draft.id}`);
    const docx = out.outputs.find((o) => o.format === 'docx')!;
    const dl = await A.raw('GET', `/api/outputs/${docx.id}/download?mode=draft`);
    const PizZip = (await import('pizzip')).default;
    const zip = new PizZip(dl.rawPayload);
    const xml = zip.file('word/document.xml')!.asText();
    expect(xml).toContain('&lt;script&gt;');
    expect(xml).not.toContain('<script>');
    expect(xml).toContain('{office_name}'); // 入力値中のタグ風文字列は差し込まれず文字として残る
    expect(xml).toContain('&lt;/w:t&gt;');
  });
});

describe('承認と正式出力の境界', () => {
  it('サンプル書式では正式出力できない（AC04）', async () => {
    const t = await A.expectOk<Array<{ activeVersion: { id: string; sampleOnly: boolean } }>>('GET', '/api/templates?kind=T08_cover_letter');
    expect(t[0]!.activeVersion.sampleOnly).toBe(true);
    const d = await A.expectOk<{ draft: { id: string } }>('POST', '/api/drafts', { matterId: ids.matters.m1, templateVersionId: t[0]!.activeVersion.id, recipientType: 'client', recipientContactId: ids.contacts.midori, idempotencyKey: 'sample-final-test' });
    const r = await A.call('POST', `/api/drafts/${d.draft.id}/render`, { mode: 'final' });
    expect([409]).toContain(r.status);
  });
  it('staff は書式を公開できず、admin 単独では承認できない', async () => {
    const tv = await sql<{ id: string; version: number }>(`SELECT id, version FROM public.template_versions WHERE org_id = $1 AND status = 'published' LIMIT 1`, [ids.orgs.aoba]);
    const r = await S.call('POST', `/api/template-versions/${tv[0]!.id}/publish`, { expectedVersion: tv[0]!.version, confirmations: { contentReviewed: true, residualTextReviewed: true, applicabilityReviewed: true }, sampleOnly: false });
    expect(r.status).toBe(403);
  });
  it('相手方代理人がいるのに本人宛てにする場合は確認が必要（可否は判定しない）', async () => {
    const t = await A.expectOk<Array<{ activeVersion: { id: string } }>>('GET', '/api/templates?kind=T01_engagement_notice');
    const r = await A.call('POST', '/api/drafts', { matterId: ids.matters.m1, templateVersionId: t[0]!.activeVersion.id, recipientType: 'opponent', recipientContactId: ids.contacts.takahashi, idempotencyKey: 'direct-opp-1' });
    expect(r.status).toBe(422);
    const ok = await A.call('POST', '/api/drafts', { matterId: ids.matters.m1, templateVersionId: t[0]!.activeVersion.id, recipientType: 'opponent', recipientContactId: ids.contacts.takahashi, idempotencyKey: 'direct-opp-2', confirmDirectToOpponent: true });
    expect(ok.status).toBe(201);
  });
  it('AC02: 同姓同名の代理人は所属で識別され、別案件の代理する側を混同しない', async () => {
    const c = await A.expectOk<Array<{ id: string; nameRaw: string; organizationNameRaw: string }>>('GET', '/api/contacts?q=佐藤一郎');
    expect(c).toHaveLength(2);
    expect(new Set(c.map((x) => x.organizationNameRaw)).size).toBe(2);
    const m1 = await A.expectOk<{ agents: Array<{ lawyerContactId: string; representedPartyId: string }>; parties: Array<{ id: string; role: string }> }>('GET', `/api/matters/${ids.matters.m1}`);
    const m3 = await A.expectOk<{ agents: Array<{ lawyerContactId: string; representedPartyId: string }>; parties: Array<{ id: string; role: string; contact: { nameRaw: string } }> }>('GET', `/api/matters/${ids.matters.m3}`);
    expect(m1.agents[0]!.lawyerContactId).toBe(ids.contacts.sato1);
    expect(m3.agents[0]!.lawyerContactId).toBe(ids.contacts.sato2);
    const p3 = m3.parties.find((p) => p.id === m3.agents[0]!.representedPartyId)!;
    expect(p3.role).toBe('opponent');
    expect(p3.contact.nameRaw).toBe('﨑山建設株式会社');
  });
});
