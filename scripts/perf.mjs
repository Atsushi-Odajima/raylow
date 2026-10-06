// AC26 計測（縮小版）: 一覧/検索 API の p95 と 1/10/100 文書生成の所要時間・失敗率を dev 環境で測る。
// 本番相当（API 4vCPU/8GB + worker 4vCPU/8GB、2,000 案件、20,000 文書 metadata、20 同時）の計測ではない。結果は docs/perf-report.md へ追記して報告する。
import fs from 'node:fs';
import path from 'node:path';
import * as OTPAuth from 'otpauth';
import { ROOT } from './db-lib.mjs';

const BASE = process.env.RAYLOW_API ?? 'http://127.0.0.1:3001';
const ORIGIN = 'http://localhost:5173';
const creds = JSON.parse(fs.readFileSync(path.join(ROOT, '.data', 'seed-credentials.json'), 'utf8'));
const user = creds.users.find((u) => u.key === 'lawyerA');
const N_MATTERS = Number(process.env.PERF_MATTERS ?? 200);
const N_DOCS = Number(process.env.PERF_DOCS ?? 100);
const CONCURRENCY = Number(process.env.PERF_CONCURRENCY ?? 20);
let cookie = '';
let csrf = '';
async function api(method, url, body) {
  const headers = { Origin: ORIGIN, Cookie: cookie };
  if (csrf) headers['X-CSRF-Token'] = csrf;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const t0 = performance.now();
  const res = await fetch(BASE + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const ms = performance.now() - t0;
  const sc = res.headers.get('set-cookie');
  if (sc) cookie = sc.split(';')[0];
  const h = res.headers.get('x-csrf-token');
  if (h) csrf = h;
  const json = await res.json();
  if (json.data?.csrfToken) csrf = json.data.csrfToken;
  return { status: res.status, data: json.data, error: json.error, ms };
}
function p95(arr) { const s = [...arr].sort((a, b) => a - b); return s[Math.floor(s.length * 0.95)] ?? 0; }

await api('POST', '/api/auth/login', { email: user.email, password: user.password });
const totp = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(user.totpSecret), digits: 6, period: 30 });
const mfa = await api('POST', '/api/auth/mfa/verify', { code: totp.generate() });
if (mfa.status !== 200) throw new Error('mfa failed ' + JSON.stringify(mfa.error));
const report = { startedAt: new Date().toISOString(), env: 'dev container (shared CPU)', matters: {}, lists: {}, render: {} };

// 1. 案件を N 件作成（当事者付き）
const t0 = performance.now();
const contacts = await api('GET', '/api/contacts?limit=5');
const client = contacts.data[0];
let created = 0;
for (let i = 0; i < N_MATTERS; i += CONCURRENCY) {
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, N_MATTERS - i) }, async (_, k) => {
    const r = await api('POST', '/api/matters', { titleRaw: `負荷試験案件 ${i + k}（架空）`, caseNumberRaw: `令和８年（ワ）第${i + k}号`, courtRaw: '東京地方裁判所', scopeRaw: '計測用' });
    if (r.status === 201) { created++; await api('POST', `/api/matters/${r.data.id}/parties`, { contactId: client.id, role: 'client' }); }
  }));
}
report.matters = { created, ms: Math.round(performance.now() - t0) };

// 2. 一覧/検索 p95（CONCURRENCY 並列 × 5 回）
for (const [name, url] of [['matters_list', '/api/matters?limit=50'], ['matters_search', `/api/matters?q=${encodeURIComponent('負荷試験')}`], ['documents_list', '/api/documents?limit=50'], ['contacts_search', `/api/contacts?q=${encodeURIComponent('佐藤')}`], ['home', '/api/home/create']]) {
  const times = [];
  let errors = 0;
  for (let round = 0; round < 5; round++) {
    const rs = await Promise.all(Array.from({ length: CONCURRENCY }, () => api('GET', url)));
    for (const r of rs) { times.push(r.ms); if (r.status !== 200) errors++; }
  }
  report.lists[name] = { samples: times.length, p50: Math.round(p95(times.map((x) => x)) ? [...times].sort((a, b) => a - b)[Math.floor(times.length / 2)] : 0), p95: Math.round(p95(times)), max: Math.round(Math.max(...times)), errors };
}

// 3. 文書生成 1 / 10 / 100（一括）。宛先は重複不可のため、計測用の連絡先を N 件作る
const tpl = (await api('GET', '/api/templates?kind=T08_cover_letter')).data[0];
const m1 = creds.ids.matters.m1;
const perfContacts = [];
for (let i = 0; i < N_DOCS; i++) {
  const r = await api('POST', '/api/contacts', { type: 'person', nameRaw: `計測用宛先 ${i}（架空）`, addressRaw: `東京都千代田区計測 ${i} 番地` });
  perfContacts.push(r.data.id);
}
for (const n of [1, 10, N_DOCS]) {
  const recipients = perfContacts.slice(0, n).map((contactId) => ({ type: 'third_party', contactId }));
  const tvs = [tpl.activeVersion.id];
  const chunks = [];
  // 1 batch は 50 宛先まで: 100 は 2 batch
  for (let i = 0; i < recipients.length; i += 50) chunks.push(recipients.slice(i, i + 50));
  const t1 = performance.now();
  const batches = [];
  for (const [i, c] of chunks.entries()) {
    const r = await api('POST', '/api/batches', { matterId: m1, templateVersionIds: tvs, recipients: c, idempotencyKey: `perf-${n}-${i}-${Date.now()}` });
    if (r.status !== 202) throw new Error('batch failed ' + JSON.stringify(r.error));
    batches.push(r.data.id);
  }
  let done = false;
  let counts = {};
  while (!done) {
    await new Promise((r) => setTimeout(r, 1000));
    done = true;
    counts = { succeeded: 0, failed: 0 };
    for (const id of batches) {
      const b = await api('GET', `/api/batches/${id}`);
      counts.succeeded += b.data.counts.succeeded;
      counts.failed += b.data.counts.failed;
      if (b.data.counts.queued + b.data.counts.running > 0) done = false;
    }
    if (performance.now() - t1 > 1800_000) break;
  }
  const ms = Math.round(performance.now() - t1);
  report.render[`docs_${n}`] = { ...counts, totalMs: ms, perDocMs: Math.round(ms / n), failureRate: counts.failed / n };
  console.log(`render ${n}: ${JSON.stringify(report.render[`docs_${n}`])}`);
}
const mem = process.memoryUsage();
report.clientMemoryMb = Math.round(mem.rss / 1024 / 1024);
fs.mkdirSync(path.join(ROOT, 'docs'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'docs', 'perf-report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
