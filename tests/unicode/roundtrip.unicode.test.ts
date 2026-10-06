/** AC07/AC08(純関数部)/AC28: 原文の DB 往復・JSON/TXT 往復・検索キー fixture・canonical hash */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { beforeAll, describe, expect, it } from 'vitest';
import { TEST_ROOT } from '../helpers/env.js';
import { loginAs, sql, type ApiClient } from '../helpers/api.js';

interface Case { id: string; raw: string; expectedSearchKey: string; mustNotEqualKeyOf?: string; note?: string }
const cases = JSON.parse(fs.readFileSync(path.join(TEST_ROOT, 'tests', 'fixtures', 'unicode_cases.json'), 'utf8')) as Case[];
let A: ApiClient;

beforeAll(async () => {
  A = await loginAs('lawyerA');
});

describe('検索キー ver1 と fixture', () => {
  it('production buildSearchKey が fixture と一致し、reference 実装も一致する', async () => {
    const { buildSearchKey, SEARCH_KEY_VERSION } = await import('@raylow/japanese-text');
    expect(SEARCH_KEY_VERSION).toBe(1);
    for (const c of cases) expect(buildSearchKey(c.raw).key, `${c.id}: ${c.note ?? ''}`).toBe(c.expectedSearchKey);
    const out = execFileSync('python3', ['-I', path.join(TEST_ROOT, 'tests', 'fixtures', 'normalization_reference.py'), '--check', path.join(TEST_ROOT, 'tests', 'fixtures', 'unicode_cases.json')], { encoding: 'utf8' });
    expect(out).toMatch(/PASS/);
    const byId = new Map(cases.map((c) => [c.id, c]));
    for (const c of cases) if (c.mustNotEqualKeyOf) expect(buildSearchKey(c.raw).key, `${c.id} must differ from ${c.mustNotEqualKeyOf}`).not.toBe(buildSearchKey(byId.get(c.mustNotEqualKeyOf)!.raw).key);
  });
  it('grapheme の ICU 版を記録し golden と一致する', async () => {
    const { graphemeLength, icuVersion } = await import('@raylow/japanese-text');
    const golden = { '葛\u{E0100}': 1, '𠮷': 1, 'が': 1, '👨‍👩‍👧': 1, 'ｶﾞ': 1, '佐藤　一郎': 5 };
    for (const [s, n] of Object.entries(golden)) expect(graphemeLength(s), s).toBe(n);
    fs.mkdirSync(path.join(TEST_ROOT, '.data', 'test-output'), { recursive: true });
    fs.writeFileSync(path.join(TEST_ROOT, '.data', 'test-output', 'icu-version.txt'), `node=${process.version} icu=${icuVersion()} unicode=${process.versions.unicode}\n`);
  });
});

describe('原文の往復（DB → API → JSON/TXT）', () => {
  it('全 fixture 原文が save→reload でコードポイント不変', async () => {
    const created: Array<{ id: string; raw: string }> = [];
    for (const c of cases) {
      if (c.raw.length === 0) continue;
      const r = await A.call<{ id: string; nameRaw: string; notesRaw: string }>('POST', '/api/contacts', { type: 'person', nameRaw: c.raw, notesRaw: c.raw, kana: '' });
      expect(r.status, `${c.id} ${JSON.stringify(r.json)}`).toBe(201);
      expect(r.data.nameRaw, c.id).toBe(c.raw);
      expect([...r.data.notesRaw].map((ch) => ch.codePointAt(0)), c.id).toEqual([...c.raw].map((ch) => ch.codePointAt(0)));
      created.push({ id: r.data.id, raw: c.raw });
    }
    for (const c of created) {
      const g = await A.expectOk<{ nameRaw: string; version: number }>('GET', `/api/contacts/${c.id}`);
      expect(g.nameRaw).toBe(c.raw);
      const row = await sql<{ name_raw: string; snapshot: { name_raw: string } }>('SELECT c.name_raw, v.snapshot FROM public.contacts c JOIN public.contact_versions v ON v.contact_id = c.id WHERE c.id = $1', [c.id]);
      expect(row[0]!.name_raw).toBe(c.raw);
      expect(row[0]!.snapshot.name_raw).toBe(c.raw);
    }
    // TXT fixture も byte 一致で往復
    const txt = fs.readFileSync(path.join(TEST_ROOT, 'tests', 'fixtures', 'unicode_fixture.txt'));
    expect(txt.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))).toBe(false);
    expect(txt.includes(Buffer.from('\r'))).toBe(false);
    const roundtrip = Buffer.from(txt.toString('utf8'), 'utf8');
    expect(roundtrip.equals(txt)).toBe(true);
  });
  it('「表記ゆれを含む」検索と「原文一致」検索が区別され、①≠1・髙≠高', async () => {
    const norm = await A.expectOk<Array<{ nameRaw: string; matchReason?: string }>>('GET', `/api/contacts?q=${encodeURIComponent('ＡＢＣ１２３')}`);
    expect(norm.some((c) => c.nameRaw === 'ABC123')).toBe(true);
    expect(norm.some((c) => c.matchReason === 'normalized')).toBe(true);
    const exact = await A.expectOk<Array<{ nameRaw: string }>>('GET', `/api/contacts?q=${encodeURIComponent('ＡＢＣ１２３')}&mode=exact`);
    expect(exact.every((c) => c.nameRaw.includes('ＡＢＣ１２３'))).toBe(true);
    const circled = await A.expectOk<Array<{ nameRaw: string }>>('GET', `/api/contacts?q=${encodeURIComponent('①')}`);
    expect(circled.every((c) => c.nameRaw.includes('①'))).toBe(true);
    const taka = await A.expectOk<Array<{ nameRaw: string }>>('GET', `/api/contacts?q=${encodeURIComponent('髙橋')}`);
    expect(taka.length).toBeGreaterThan(0);
    expect(taka.every((c) => c.nameRaw.includes('髙'))).toBe(true);
  });
  it('canonical hash は原文で決まり、全角/半角で異なる', async () => {
    const { hashCanonical } = await import('@raylow/domain');
    const a = await hashCanonical({ fields: { x: { rawValue: 'ＡＢＣ' } } });
    const b = await hashCanonical({ fields: { x: { rawValue: 'ABC' } } });
    expect(a).not.toBe(b);
  });
  it('和暦・証拠番号の解析が原文を保持する', async () => {
    const { parseJapaneseDate, parseEvidenceLabel } = await import('@raylow/japanese-text');
    expect(parseJapaneseDate('令和元年５月１日')).toMatchObject({ iso: '2019-05-01', raw: '令和元年５月１日', needsConfirmation: false });
    expect(parseJapaneseDate('令和元年４月３０日').warnings).toContain('era_boundary_mismatch');
    const e = parseEvidenceLabel('甲第３号証の１');
    expect(e.numberRaw).toBe('３');
    expect(e.canonical).toEqual({ symbol: '甲', number: 3, branch: [1] });
  });
});
