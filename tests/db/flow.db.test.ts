/**
 * 縦断フロー（API in-process + worker in-process）:
 * 書式登録→検査→スキーマ→試作→公開(所内承認版)→案件→受任通知→本文→render→レビュー依頼→別弁護士が承認→正式出力→送付記録。
 * AC01/AC03/AC10/AC11/AC13/AC14/AC15/AC16/AC17 をカバー。
 */
import fs from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { TEST_ROOT } from '../helpers/env.js';
import { loginAs, seedCreds, sql, waitJob, type ApiClient } from '../helpers/api.js';

let A: ApiClient;
let B: ApiClient;
let ids: ReturnType<typeof seedCreds>['ids'];
let publishedTvId = '';
let draftId = '';
let reviewId = '';
let lawyerBUserId = '';

beforeAll(async () => {
  ids = seedCreds().ids;
  A = await loginAs('lawyerA');
  B = await loginAs('lawyerB');
  lawyerBUserId = (await sql<{ id: string }>('SELECT id FROM public.app_users WHERE email_key = $1', ['ken@aoba.example']))[0]!.id;
});

async function importDemo(client: ApiClient, kind: string, name: string): Promise<{ templateId: string; versionId: string; jobId: string }> {
  const dir = path.join(TEST_ROOT, 'templates', 'demo', kind);
  const docx = fs.readFileSync(path.join(dir, 'template.docx'));
  const boundary = '----raylowtest' + Date.now();
  const fields = JSON.stringify({ name, kind, scope: 'negotiation' });
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="fields"\r\n\r\n${fields}\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="t.docx"\r\nContent-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document\r\n\r\n`),
    docx,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const res = await client.raw('POST', '/api/templates/import', undefined, { 'content-type': `multipart/form-data; boundary=${boundary}` }, body);
  expect(res.statusCode, res.body).toBe(202);
  return (res.json() as { data: { templateId: string; versionId: string; jobId: string } }).data;
}

describe('書式の登録→公開（所内承認版）', () => {
  it('独自 DOCX を登録し検査 job が成功、スキーマ保存、試作、公開できる', async () => {
    const imp = await importDemo(A, 'T01_engagement_notice', '受任通知（所内版テスト）');
    const job = await waitJob(A, imp.jobId);
    expect(job.state, JSON.stringify(job)).toBe('succeeded');
    const v1 = await A.expectOk<{ version: number; inspectionReport: { tags: Array<{ key: string }>; stats: { unmappedKeys: string[] } }; status: string }>('GET', `/api/template-versions/${imp.versionId}`);
    expect(v1.inspectionReport.tags.length).toBeGreaterThan(10);
    // 初期スキーマでは未定義タグがあるため公開不可。デモ schema.json を適用
    const schema = JSON.parse(fs.readFileSync(path.join(TEST_ROOT, 'templates', 'demo', 'T01_engagement_notice', 'schema.json'), 'utf8')) as Record<string, unknown>;
    const upd = await A.call<{ version: number }>('PUT', `/api/template-versions/${imp.versionId}/schema`, { expectedVersion: v1.version, fieldSchema: schema, tagMap: {} });
    expect(upd.status, JSON.stringify(upd.json)).toBe(200);
    // 試作前の公開は 409
    const early = await A.call('POST', `/api/template-versions/${imp.versionId}/publish`, { expectedVersion: upd.data.version, confirmations: { contentReviewed: true, residualTextReviewed: true, applicabilityReviewed: true }, sampleOnly: false });
    expect(early.status).toBe(409);
    const test = await A.expectOk<{ jobId: string }>('POST', `/api/template-versions/${imp.versionId}/test`, {});
    const tj = await waitJob(A, test.jobId);
    expect(tj.state, JSON.stringify(tj)).toBe('succeeded');
    expect((tj.result as { unembeddedFonts: string[] }).unembeddedFonts).toEqual([]);
    const v2 = await A.expectOk<{ version: number }>('GET', `/api/template-versions/${imp.versionId}`);
    // staff は公開できない
    const S = await loginAs('staff');
    const staffPub = await S.call('POST', `/api/template-versions/${imp.versionId}/publish`, { expectedVersion: v2.version, confirmations: { contentReviewed: true, residualTextReviewed: true, applicabilityReviewed: true }, sampleOnly: false });
    expect(staffPub.status).toBe(403);
    const pub = await A.call<{ status: string; sampleOnly: boolean; approvedBy: string }>('POST', `/api/template-versions/${imp.versionId}/publish`, { expectedVersion: v2.version, confirmations: { contentReviewed: true, residualTextReviewed: true, applicabilityReviewed: true }, sampleOnly: false });
    expect(pub.status, JSON.stringify(pub.json)).toBe(200);
    expect(pub.data.status).toBe('published');
    expect(pub.data.sampleOnly).toBe(false);
    publishedTvId = imp.versionId;
  });
  it('公開後の編集は 409（複製して新しい版）', async () => {
    const v = await A.expectOk<{ version: number; fieldSchema: unknown }>('GET', `/api/template-versions/${publishedTvId}`);
    const r = await A.call('PUT', `/api/template-versions/${publishedTvId}/schema`, { expectedVersion: v.version, fieldSchema: v.fieldSchema, tagMap: {} });
    expect(r.status).toBe(409);
  });
});

describe('受任通知の作成→承認→正式出力', () => {
  it('AC01: 代理人を選ぶと自事務所/宛先/依頼者/案件名が自動差込される', async () => {
    const m = await A.expectOk<{ agents: Array<{ lawyerContactId: string }> }>('GET', `/api/matters/${ids.matters.m1}`);
    const d = await A.call<{ draft: { id: string; version: number; status: string }; currentRevision: { snapshot: { fields: Record<string, { rawValue: unknown; sourceId: string | null }> } } }>('POST', '/api/drafts', { matterId: ids.matters.m1, templateVersionId: publishedTvId, recipientType: 'opponent_agent', recipientContactId: m.agents[0]!.lawyerContactId, idempotencyKey: 'flow-test-draft-1' });
    expect(d.status, JSON.stringify(d.json)).toBe(201);
    const f = d.data.currentRevision.snapshot.fields;
    expect(f.office_name?.rawValue).toBe('青葉法律事務所');
    expect(f.recipient_name?.rawValue).toBe('佐藤 一郎');
    expect(f.client_name?.rawValue).toBe('株式会社ミドリ商事');
    expect(f.matter_title?.rawValue).toContain('売買代金請求事件');
    expect(f.office_name?.sourceId).toBeTruthy();
    draftId = d.data.draft.id;
    // 同じ idempotencyKey は同じ草案
    const again = await A.expectOk<{ draft: { id: string } }>('POST', '/api/drafts', { matterId: ids.matters.m1, templateVersionId: publishedTvId, recipientType: 'opponent_agent', recipientContactId: m.agents[0]!.lawyerContactId, idempotencyKey: 'flow-test-draft-1' });
    expect(again.draft.id).toBe(draftId);
  });
  it('AC13: 必須欄欠落は preflight error、未置換タグは出力を止める', async () => {
    const d = await A.expectOk<{ preflight: { issues: Array<{ code: string; fieldKey?: string }> } }>('GET', `/api/drafts/${draftId}`);
    expect(d.preflight.issues.some((i) => i.code === 'required_missing')).toBe(true);
    const rr = await A.call('POST', `/api/drafts/${draftId}/request-review`, { reviewerId: lawyerBUserId });
    expect(rr.status).toBe(422);
  });
  it('AC17: expectedVersion 不一致は 409 で本文を黙って上書きしない', async () => {
    const d = await A.expectOk<{ draft: { version: number }; currentRevision: { snapshot: { fields: Record<string, unknown> }; ast: unknown } }>('GET', `/api/drafts/${draftId}`);
    const r = await A.call('PUT', `/api/drafts/${draftId}/revisions`, { expectedVersion: d.draft.version + 5, fields: d.currentRevision.snapshot.fields, ast: { schemaVersion: 1, blocks: [] }, attachments: [] });
    expect(r.status).toBe(409);
    expect(r.error?.currentVersion).toBe(d.draft.version);
  });
  it('本文を保存し render → ready_for_review', async () => {
    const d = await A.expectOk<{ draft: { version: number }; currentRevision: { snapshot: { fields: Record<string, { rawValue: unknown }> } }; templateVersion: { fieldSchema: { fields: Array<{ key: string; source: string; type: string; label: string }> } } }>('GET', `/api/drafts/${draftId}`);
    const fields = { ...d.currentRevision.snapshot.fields };
    for (const f of d.templateVersion.fieldSchema.fields) {
      const cur = fields[f.key];
      if ((!cur || cur.rawValue === '' || cur.rawValue == null) && f.source === 'input') fields[f.key] = { rawValue: f.type === 'boolean' ? false : f.type === 'array' ? [] : `${f.label}（テスト入力）` };
    }
    fields.subject = { rawValue: '受任のご通知' };
    const ast = { schemaVersion: 1, blocks: [{ id: 'b1', type: 'paragraph', text: '当職は依頼者から委任を受けました。（テスト本文）' }] };
    const saved = await A.expectOk<{ draft: { version: number; status: string }; currentRevision: { revision: number; hash: string } }>('PUT', `/api/drafts/${draftId}/revisions`, { expectedVersion: d.draft.version, fields, ast, attachments: [] });
    expect(saved.currentRevision.revision).toBe(2);
    const r = await A.expectOk<{ jobId: string }>('POST', `/api/drafts/${draftId}/render`, { mode: 'draft' });
    const j = await waitJob(A, r.jobId);
    expect(j.state, JSON.stringify(j)).toBe('succeeded');
    const d2 = await A.expectOk<{ draft: { status: string; version: number }; outputs: Array<{ format: string; mode: string }>; preflight: { blocking: boolean; issues: Array<{ code: string; severity: string }> } }>('GET', `/api/drafts/${draftId}`);
    expect(d2.draft.status).toBe('ready_for_review');
    expect(d2.outputs.map((o) => `${o.format}/${o.mode}`).sort()).toEqual(['docx/draft', 'pdf/draft']);
    expect(d2.preflight.blocking, JSON.stringify(d2.preflight.issues)).toBe(false);
  });
  it('AC14: 最終編集者本人・staff・未割当は承認できない。別弁護士は承認できる', async () => {
    const self = await A.call('POST', `/api/drafts/${draftId}/request-review`, { reviewerId: (await sql<{ id: string }>('SELECT id FROM public.app_users WHERE email_key = $1', ['hanako@aoba.example']))[0]!.id });
    expect(self.status).toBe(422);
    const rv = await A.call<{ id: string; targetHash: string; version: number }>('POST', `/api/drafts/${draftId}/request-review`, { reviewerId: lawyerBUserId });
    expect(rv.status, JSON.stringify(rv.json)).toBe(201);
    reviewId = rv.data.id;
    const S = await loginAs('staff');
    const sdec = await S.call('POST', `/api/reviews/${reviewId}/decision`, { decision: 'approved', targetHash: rv.data.targetHash, expectedVersion: rv.data.version, confirmations: [] });
    expect([403, 404]).toContain(sdec.status);
    const adec = await A.call('POST', `/api/reviews/${reviewId}/decision`, { decision: 'approved', targetHash: rv.data.targetHash, expectedVersion: rv.data.version, confirmations: [] });
    expect(adec.status).toBe(403); // 最終編集者本人
    const stale = await B.call('POST', `/api/reviews/${reviewId}/decision`, { decision: 'approved', targetHash: 'deadbeef', expectedVersion: rv.data.version, confirmations: [] });
    expect(stale.status).toBe(409);
    const detail = await B.expectOk<{ canDecide: boolean; hashCurrent: boolean; preflight: { confirmationsRequired: string[] } }>('GET', `/api/reviews/${reviewId}`);
    expect(detail.canDecide).toBe(true);
    expect(detail.hashCurrent).toBe(true);
    const confirmations = detail.preflight.confirmationsRequired.map((c) => ({ code: c, reason: 'テストで確認済み' }));
    const ok = await B.call<{ review: { status: string }; draft: { status: string } }>('POST', `/api/reviews/${reviewId}/decision`, { decision: 'approved', targetHash: rv.data.targetHash, expectedVersion: rv.data.version, confirmations });
    expect(ok.status, JSON.stringify(ok.json)).toBe(200);
    expect(ok.data.review.status).toBe('approved');
    expect(ok.data.draft.status).toBe('approved');
  });
  it('AC16: 正式出力は承認済み版のみ。ダウンロードしても送付済みにならない', async () => {
    const r = await A.expectOk<{ jobId: string }>('POST', `/api/drafts/${draftId}/render`, { mode: 'final' });
    const j = await waitJob(A, r.jobId);
    expect(j.state, JSON.stringify(j)).toBe('succeeded');
    const out = await A.expectOk<{ outputs: Array<{ id: string; format: string; mode: string }>; dispatches: unknown[] }>('GET', `/api/documents/${draftId}/output`);
    const pdf = out.outputs.find((o) => o.format === 'pdf' && o.mode === 'final')!;
    expect(pdf).toBeTruthy();
    const dl = await A.raw('GET', `/api/outputs/${pdf.id}/download?mode=final`);
    expect(dl.statusCode).toBe(200);
    expect(dl.headers['content-type']).toBe('application/pdf');
    expect(dl.headers['cache-control']).toBe('no-store');
    expect(dl.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
    fs.mkdirSync(path.join(TEST_ROOT, '.data', 'test-output'), { recursive: true });
    fs.writeFileSync(path.join(TEST_ROOT, '.data', 'test-output', 'T01_final.pdf'), dl.rawPayload);
    const out2 = await A.expectOk<{ dispatches: unknown[] }>('GET', `/api/documents/${draftId}/output`);
    expect(out2.dispatches).toHaveLength(0);
    // 送付記録は手動。記録者本人は確認できない。
    const dr = await A.call<{ id: string; status: string; version: number }>('POST', '/api/dispatch-records', { matterId: ids.matters.m1, outputId: pdf.id, recipientSnapshot: { nameRaw: '佐藤 一郎', organizationNameRaw: '第一法律事務所', addressRaw: '', type: 'opponent_agent' }, method: 'registered_post', sentAt: new Date().toISOString(), receiptRaw: '', receivedDocumentsRaw: '' });
    expect(dr.status, JSON.stringify(dr.json)).toBe(201);
    expect(dr.data.status).toBe('recorded');
    const selfVerify = await A.call('POST', `/api/dispatch-records/${dr.data.id}/verify`, { expectedVersion: dr.data.version });
    expect(selfVerify.status).toBe(403);
    const v = await B.call<{ status: string }>('POST', `/api/dispatch-records/${dr.data.id}/verify`, { expectedVersion: dr.data.version });
    expect(v.status).toBe(200);
    expect(v.data.status).toBe('received_verified');
  });
  it('AC10/AC11: マスター変更は確定版を変えず、草案には更新候補のみ', async () => {
    const offices = await A.expectOk<Array<{ id: string; version: number; nameRaw: string; addressRaw: string; postcodeRaw: string; phoneRaw: string; faxRaw: string; emailRaw: string; signatureSettings: unknown; honorificSettings: unknown }>>('GET', '/api/offices');
    const cur = offices[0]!;
    const upd = await A.call<{ revision: number }>('PUT', `/api/offices/${cur.id}`, { ...cur, addressRaw: '東京都千代田区霞が関一丁目１番１号　青葉ビル６階（移転後）', expectedVersion: cur.version });
    expect(upd.status, JSON.stringify(upd.json)).toBe(200);
    const before = await A.expectOk<{ approvedRevision: { snapshot: { fields: Record<string, { rawValue: unknown }> } } }>('GET', `/api/drafts/${draftId}`);
    expect(before.approvedRevision.snapshot.fields.office_address?.rawValue).toContain('５階');
    const cands = await A.expectOk<{ candidates: Array<{ fieldKey: string; newValue: string; manuallyOverridden: boolean }> }>('POST', `/api/drafts/${draftId}/refresh-candidates`);
    const c = cands.candidates.find((x) => x.fieldKey === 'office_address');
    expect(c?.newValue).toContain('６階');
    // 承認済み草案に候補を採用すると承認が失効し新 revision になる
    const d = await A.expectOk<{ draft: { version: number } }>('GET', `/api/drafts/${draftId}`);
    const applied = await A.expectOk<{ draft: { status: string }; currentRevision: { revision: number; snapshot: { fields: Record<string, { rawValue: unknown }> } }; approvedRevision: { snapshot: { fields: Record<string, { rawValue: unknown }> } } | null }>('POST', `/api/drafts/${draftId}/apply-candidates`, { expectedVersion: d.draft.version, fieldKeys: ['office_address'] });
    expect(applied.draft.status).toBe('draft');
    expect(applied.currentRevision.snapshot.fields.office_address?.rawValue).toContain('６階');
    // 旧承認版の snapshot は不変
    const rev = await sql<{ snapshot_json: { fields: Record<string, { rawValue: string }> } }>('SELECT snapshot_json FROM public.draft_revisions WHERE draft_id = $1 AND revision = 2', [draftId]);
    expect(rev[0]!.snapshot_json.fields.office_address!.rawValue).toContain('５階');
    // 旧承認を使った正式出力は拒否
    const out = await A.expectOk<{ outputs: Array<{ id: string }> }>('GET', `/api/documents/${draftId}/output`);
    expect(out.outputs).toHaveLength(0);
  });
  it('AC15: Word 編集版の再取込は別版となり旧承認で正式出力できない', async () => {
    const docxBytes = fs.readFileSync(path.join(TEST_ROOT, 'tests', 'fixtures', 'docx', 'forbidden', 'clean_minimal.docx'));
    const boundary = '----raylowext' + Date.now();
    const body = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="edited.docx"\r\nContent-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document\r\n\r\n`), docxBytes, Buffer.from(`\r\n--${boundary}--\r\n`)]);
    const res = await A.raw('POST', `/api/drafts/${draftId}/external-edit`, undefined, { 'content-type': `multipart/form-data; boundary=${boundary}` }, body);
    expect(res.statusCode, res.body).toBe(201);
    const d = (res.json() as { data: { currentRevision: { kind: string; revision: number }; draft: { status: string } } }).data;
    expect(d.currentRevision.kind).toBe('external_edit');
    expect(d.draft.status).toBe('draft');
    const { drainJobs } = await import('../helpers/api.js');
    await drainJobs();
    await drainJobs();
    const d2 = await A.expectOk<{ draft: { status: string }; outputs: Array<{ mode: string; format: string; revisionId: string }>; currentRevision: { id: string } }>('GET', `/api/drafts/${draftId}`);
    const ext = d2.outputs.filter((o) => o.revisionId === d2.currentRevision.id);
    expect(ext.map((o) => `${o.format}/${o.mode}`).sort()).toEqual(['docx/draft', 'pdf/draft']);
    const fin = await A.call('POST', `/api/drafts/${draftId}/render`, { mode: 'final' });
    expect(fin.status).toBe(409);
  });
  it('AC03: 回答書と答弁書は別種類で、認否は自動選択されない', async () => {
    const t02 = await A.expectOk<Array<{ kind: string; activeVersion: { id: string } }>>('GET', '/api/templates?kind=T02_reply_letter');
    const t13 = await A.expectOk<Array<{ kind: string; activeVersion: { id: string } }>>('GET', '/api/templates?kind=T13_answer');
    expect(t02[0]!.kind).not.toBe(t13[0]!.kind);
    const d = await A.expectOk<{ currentRevision: { snapshot: { fields: Record<string, { rawValue: unknown }> } }; templateVersion: { fieldSchema: { fields: Array<{ key: string; legalJudgement?: boolean; defaultPolicy?: string }> } } }>('POST', '/api/drafts', { matterId: ids.matters.m1, templateVersionId: t13[0]!.activeVersion.id, recipientType: 'court', idempotencyKey: 'flow-test-t13' });
    const legal = d.templateVersion.fieldSchema.fields.filter((f) => f.legalJudgement);
    expect(legal.length).toBeGreaterThan(0);
    for (const f of legal) {
      const v = d.currentRevision.snapshot.fields[f.key]?.rawValue;
      expect(v === '' || v === null || v === undefined || (Array.isArray(v) && v.length === 0) || v === false).toBe(true);
    }
  });
});
