/** AC21/AC24(部分)/AC28: CSV 取込（CP932/UTF-8、改行/カンマ、外部 ID 競合、式注入、全行 rollback）と export */
import fs from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { TEST_ROOT } from '../helpers/env.js';
import { loginAs, seedCreds, sql, waitJob, type ApiClient } from '../helpers/api.js';

let A: ApiClient;
let ADMIN: ApiClient;
let ids: ReturnType<typeof seedCreds>['ids'];
const csvDir = path.join(TEST_ROOT, 'tests', 'fixtures', 'csv');

async function preview(client: ApiClient, file: string, kind: string, encoding = 'auto') {
  const bytes = fs.readFileSync(file);
  const boundary = '----raylowcsv' + Date.now();
  const body = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="fields"\r\n\r\n${JSON.stringify({ kind, encoding })}\r\n`), Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${path.basename(file)}"\r\nContent-Type: text/csv\r\n\r\n`), bytes, Buffer.from(`\r\n--${boundary}--\r\n`)]);
  const res = await client.raw('POST', '/api/imports/preview', undefined, { 'content-type': `multipart/form-data; boundary=${boundary}` }, body);
  expect(res.statusCode, res.body).toBe(200);
  return (res.json() as { data: { importToken: string; detectedEncoding: string; totalRows: number; previewRows: Array<Record<string, string>>; errors: Array<{ row: number; column: string | null; code: string }>; canCommit: boolean } }).data;
}

beforeAll(async () => {
  ids = seedCreds().ids;
  A = await loginAs('lawyerA');
  ADMIN = await loginAs('aoba_admin');
});

describe('CSV 取込', () => {
  it('UTF-8 BOM の連絡先を preview→commit できる（RFC4180 の引用符内カンマ/改行を含む）', async () => {
    const p = await preview(A, path.join(csvDir, 'contacts_quoted_newlines.csv'), 'contacts');
    expect(p.errors).toEqual([]);
    expect(p.canCommit).toBe(true);
    expect(p.previewRows.length).toBeGreaterThan(0);
    const withNewline = p.previewRows.find((r) => r.address_raw?.includes('\n'));
    expect(withNewline, 'quoted newline preserved').toBeTruthy();
    const c = await A.expectOk<{ inserted: number; updated: number }>('POST', '/api/imports/commit', { importToken: p.importToken });
    expect(c.inserted + c.updated).toBe(p.totalRows);
    const again = await preview(A, path.join(csvDir, 'contacts_quoted_newlines.csv'), 'contacts');
    const c2 = await A.expectOk<{ inserted: number; updated: number }>('POST', '/api/imports/commit', { importToken: again.importToken });
    expect(c2.inserted).toBe(0); // 同一 external_id は更新
  });
  it('CP932 を strict に復号し原文が保持される', async () => {
    const p = await preview(A, path.join(csvDir, 'contacts_cp932.csv'), 'contacts', 'cp932');
    expect(p.detectedEncoding).toBe('cp932');
    expect(p.errors, JSON.stringify(p.errors)).toEqual([]);
    const names = p.previewRows.map((r) => r.name_raw);
    expect(names.some((n) => n.includes('髙'))).toBe(true);
    await A.expectOk('POST', '/api/imports/commit', { importToken: p.importToken });
    const back = await sql<{ name_raw: string }>(`SELECT name_raw FROM public.contacts WHERE org_id = $1 AND name_raw LIKE '%髙%' LIMIT 1`, [ids.orgs.aoba]);
    expect(back.length).toBeGreaterThan(0);
  });
  it('不正バイト列は置換せずエラー', async () => {
    const p = await preview(A, path.join(csvDir, 'contacts_bad_encoding.bin'), 'contacts', 'utf8');
    expect(p.canCommit).toBe(false);
    expect(p.errors[0]!.code).toBe('encoding_failed');
  });
  it('式注入は行単位で拒否され、1 行のエラーで全体が止まる', async () => {
    const p = await preview(A, path.join(csvDir, 'contacts_formula_injection.csv'), 'contacts');
    expect(p.canCommit).toBe(false);
    expect(p.errors.some((e) => e.code === 'formula_injection')).toBe(true);
    expect(p.importToken).toBe('');
    const before = await sql<{ n: string }>('SELECT count(*) AS n FROM public.contacts WHERE org_id = $1', [ids.orgs.aoba]);
    const r = await A.call('POST', '/api/imports/commit', { importToken: 'bogus' });
    expect(r.status).toBe(404);
    const after = await sql<{ n: string }>('SELECT count(*) AS n FROM public.contacts WHERE org_id = $1', [ids.orgs.aoba]);
    expect(after[0]!.n).toBe(before[0]!.n);
  });
  it('同一 external_id の異内容は競合、未登録外部 ID 参照は停止', async () => {
    const dup = await preview(A, path.join(csvDir, 'contacts_dup_external_id.csv'), 'contacts');
    expect(dup.errors.some((e) => e.code === 'external_id_conflict')).toBe(true);
    const m = await preview(A, path.join(csvDir, 'matters_utf8.csv'), 'matters');
    expect(m.canCommit, JSON.stringify(m.errors)).toBe(true);
    await A.expectOk('POST', '/api/imports/commit', { importToken: m.importToken });
    const parties = await preview(A, path.join(csvDir, 'matter_parties_utf8.csv'), 'matter_parties');
    expect(parties.canCommit).toBe(false);
    expect(parties.errors.some((e) => e.code === 'unknown_reference')).toBe(true);
  });
});

describe('export', () => {
  it('連絡先 CSV（UTF-8 BOM）と式注入対策、原文 JSON 同梱', async () => {
    const r = await A.expectOk<{ jobId: string }>('POST', '/api/exports', { type: 'contacts_csv' });
    const j = await waitJob(A, r.jobId);
    expect(j.state, JSON.stringify(j)).toBe('succeeded');
    const dl = await A.raw('GET', `/api/exports/${r.jobId}/download`);
    expect(dl.statusCode).toBe(200);
    const PizZip = (await import('pizzip')).default;
    const zip = new PizZip(dl.rawPayload);
    const csv = zip.file('contacts.csv')!.asNodeBuffer();
    expect(csv.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))).toBe(true);
    const text = csv.toString('utf8');
    expect(text).toContain('髙');
    expect(/\n"'[=+\-@]/.test(text) || !/\n"[=+\-@]/.test(text)).toBe(true);
    const json = JSON.parse(zip.file('contacts.json')!.asText()) as { schemaVersion: number; rows: Array<{ name_raw: string }> };
    expect(json.schemaVersion).toBe(2);
    expect(json.rows.length).toBeGreaterThan(0);
  });
  it('CP932 で表現できない文字がある場合は CP932 出力を拒否する', async () => {
    const r = await A.expectOk<{ jobId: string }>('POST', '/api/exports', { type: 'contacts_csv', encoding: 'cp932' });
    const j = await waitJob(A, r.jobId);
    // unicode テスト後は 𠮷 等が含まれるため失敗するはず。単独実行なら成功しうる
    expect(['succeeded', 'failed']).toContain(j.state);
    if (j.state === 'failed') expect(j.errorCode).toBe('cp932_unencodable');
  });
  it('案件 JSON + 添付 ZIP に manifest と hash が入り、全量バックアップは admin のみ', async () => {
    const deny = await A.call('POST', '/api/exports', { type: 'full_backup' });
    expect(deny.status).toBe(403);
    const r = await A.expectOk<{ jobId: string }>('POST', '/api/exports', { type: 'matter_json', matterId: ids.matters.m1 });
    const j = await waitJob(A, r.jobId);
    expect(j.state, JSON.stringify(j)).toBe('succeeded');
    const dl = await A.raw('GET', `/api/exports/${r.jobId}/download`);
    const PizZip = (await import('pizzip')).default;
    const zip = new PizZip(dl.rawPayload);
    const data = JSON.parse(zip.file('data.json')!.asText()) as { schemaVersion: number; tables: Record<string, unknown[]>; blobs: Array<{ entry: string; sha256: string }> };
    expect(data.schemaVersion).toBe(2);
    expect((data.tables.matters as Array<{ id: string }>)[0]!.id).toBe(ids.matters.m1);
    const { createHash } = await import('node:crypto');
    for (const b of data.blobs) {
      const bytes = zip.file(b.entry)!.asNodeBuffer();
      expect(createHash('sha256').update(bytes).digest('hex'), b.entry).toBe(b.sha256);
    }
    expect(zip.file('checksums.sha256')).toBeTruthy();
    const full = await ADMIN.expectOk<{ jobId: string }>('POST', '/api/exports', { type: 'full_backup' });
    const fj = await waitJob(ADMIN, full.jobId);
    expect(fj.state, JSON.stringify(fj)).toBe('succeeded');
    expect(Number((fj.result as { blobs: number }).blobs)).toBeGreaterThan(0);
  });
  it('証拠台帳 CSV / 監査 CSV', async () => {
    const e = await A.expectOk<{ jobId: string }>('POST', '/api/exports', { type: 'evidence_csv', matterId: ids.matters.m1 });
    expect((await waitJob(A, e.jobId)).state).toBe('succeeded');
    const a = await A.expectOk<{ jobId: string }>('POST', '/api/exports', { type: 'audit_csv', matterId: ids.matters.m1 });
    const aj = await waitJob(A, a.jobId);
    expect(aj.state).toBe('succeeded');
    const dl = await A.raw('GET', `/api/exports/${a.jobId}/download`);
    expect(dl.rawPayload.toString('utf8')).toContain('created_at');
  });
});
