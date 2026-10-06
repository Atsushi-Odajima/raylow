// 縦断スモーク: 事務所→案件→受任通知→DOCX→PDF（架空データ）。API/worker が起動していること。
import fs from 'node:fs';
import path from 'node:path';
import * as OTPAuth from 'otpauth';
import { ROOT } from './db-lib.mjs';

const BASE = process.env.RAYLOW_API ?? 'http://127.0.0.1:3001';
const ORIGIN = 'http://localhost:5173';
const creds = JSON.parse(fs.readFileSync(path.join(ROOT, '.data', 'seed-credentials.json'), 'utf8'));
const userKey = process.argv[2] ?? 'lawyerA';
const user = creds.users.find((u) => u.key === userKey);
let cookie = '';
let csrf = '';

async function api(method, url, body, raw = false) {
  const headers = { Origin: ORIGIN, Cookie: cookie };
  if (csrf) headers['X-CSRF-Token'] = csrf;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(BASE + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const sc = res.headers.get('set-cookie');
  if (sc) cookie = sc.split(';')[0];
  const hdrCsrf = res.headers.get('x-csrf-token');
  if (hdrCsrf) csrf = hdrCsrf;
  if (raw) return res;
  const json = await res.json();
  if (!res.ok) throw new Error(`${method} ${url} -> ${res.status} ${JSON.stringify(json)}`);
  if (json.data && json.data.csrfToken) csrf = json.data.csrfToken;
  return json.data;
}

const totp = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(user.totpSecret), digits: 6, period: 30 });
console.log('login as', user.email);
await api('POST', '/api/auth/login', { email: user.email, password: user.password });
const sess = await api('POST', '/api/auth/mfa/verify', { code: totp.generate() });
console.log('session:', sess.user.displayName, sess.role, 'org=', sess.org.name);
const home = await api('GET', '/api/home/create');
console.log('home: needsSetup=', home.needsSetup, 'templates=', home.frequentTemplates.length);
const matters = await api('GET', '/api/matters?q=売買');
console.log('matters:', matters.map((m) => m.titleRaw));
const m1 = matters[0];
const detail = await api('GET', `/api/matters/${m1.id}`);
console.log('agents:', detail.agents.map((a) => `${a.lawyerContact.nameRaw}（${a.lawyerContact.organizationNameRaw}）`));
const contacts = await api('GET', '/api/contacts?q=佐藤一郎');
console.log('同姓同名候補:', contacts.map((c) => `${c.nameRaw}/${c.organizationNameRaw}/${c.matchReason}`));
const templates = await api('GET', '/api/templates?kind=T01_engagement_notice');
const tv = templates[0].activeVersion;
console.log('template:', templates[0].name, 'version', tv.revision, tv.status, 'sampleOnly=', tv.sampleOnly);
const agent = detail.agents[0];
const draft = await api('POST', '/api/drafts', { matterId: m1.id, templateVersionId: tv.id, recipientType: 'opponent_agent', recipientContactId: agent.lawyerContactId, idempotencyKey: `smoke-${Date.now()}` });
console.log('draft created:', draft.draft.id, draft.draft.titleRaw, 'status=', draft.draft.status);
const fields = draft.currentRevision.snapshot.fields;
console.log('auto-filled:', Object.fromEntries(Object.entries(fields).filter(([, v]) => v.sourceId).map(([k, v]) => [k, v.rawValue])));
const missing = draft.preflight.issues.filter((i) => i.severity === 'error').map((i) => i.fieldKey ?? i.code);
console.log('preflight errors before edit:', missing);
// 不足項目を補い本文を入れる
const newFields = { ...fields };
for (const f of draft.templateVersion.fieldSchema.fields) {
  const v = newFields[f.key];
  const empty = !v || v.rawValue === '' || v.rawValue == null;
  if (empty && f.source === 'input') {
    if (f.type === 'boolean') newFields[f.key] = { rawValue: false };
    else if (f.type === 'array') newFields[f.key] = { rawValue: [] };
    else if (f.type === 'date') newFields[f.key] = { rawValue: '令和８年１０月６日' };
    else newFields[f.key] = { rawValue: `（${f.label}：架空の入力）`, manuallyOverridden: true };
  }
}
const ast = { schemaVersion: 1, blocks: [{ id: 'b1', type: 'paragraph', text: '当職は、株式会社ミドリ商事から委任を受け、下記案件の代理人となりましたので、ご通知申し上げます。（架空デモ本文）' }, { id: 'b2', type: 'numberedParagraph', numberLabel: '１', text: '今後のご連絡は当職宛てにお願いいたします。', level: 1 }] };
const saved = await api('PUT', `/api/drafts/${draft.draft.id}/revisions`, { expectedVersion: draft.draft.version, fields: newFields, ast, attachments: [{ name: '委任状写し', copies: '１通' }] });
console.log('saved revision', saved.currentRevision.revision, 'hash', saved.currentRevision.hash.slice(0, 12), 'errors:', saved.preflight.issues.filter((i) => i.severity === 'error').map((i) => i.code));
const render = await api('POST', `/api/drafts/${draft.draft.id}/render`, { mode: 'draft' });
console.log('render job', render.jobId);
let job;
for (let i = 0; i < 120; i++) {
  await new Promise((r) => setTimeout(r, 1000));
  job = await api('GET', `/api/jobs/${render.jobId}`);
  if (job.state === 'succeeded' || job.state === 'failed') break;
}
console.log('job:', job.state, job.errorCode ?? '', job.errorMessage ?? '', JSON.stringify(job.progress));
if (job.state !== 'succeeded') process.exit(1);
const d2 = await api('GET', `/api/drafts/${draft.draft.id}`);
console.log('status:', d2.draft.status, 'outputs:', d2.outputs.map((o) => `${o.format}/${o.mode}/${o.sha256.slice(0, 8)}`));
console.log('preflight after render:', d2.preflight.issues.map((i) => `${i.severity}:${i.code}`));
const outDir = path.join(ROOT, '.data', 'smoke');
fs.mkdirSync(outDir, { recursive: true });
for (const o of d2.outputs) {
  const res = await api('GET', `/api/outputs/${o.id}/download?mode=draft`, undefined, true);
  const buf = Buffer.from(await res.arrayBuffer());
  const p = path.join(outDir, `T01_draft.${o.format}`);
  fs.writeFileSync(p, buf);
  console.log('downloaded', p, buf.length, 'bytes', res.headers.get('content-type'));
}
// 正式出力は未承認なので拒否されるはず
const pdfOut = d2.outputs.find((o) => o.format === 'pdf');
const finalRes = await api('GET', `/api/outputs/${pdfOut.id}/download?mode=final`, undefined, true);
console.log('final download before approval ->', finalRes.status, (await finalRes.json()).error?.code);
console.log('SMOKE OK');
