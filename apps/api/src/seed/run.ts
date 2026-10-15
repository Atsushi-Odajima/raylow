/**
 * 開発・デモ用 seed（架空データのみ）。
 * 架空「青葉法律事務所」、同姓同名の「佐藤一郎」2名、売買代金案件、別案件 barrier、20 書式デモ。
 * パスワード/TOTP secret は初期化時に生成し .data/seed-credentials.json に保存（公開 repo へ固定値を入れない）。
 * 配備環境では SEED_DEMO_PASSWORD / SEED_DEMO_TOTP_SECRET（環境変数、配備時に生成）で全デモユーザーに同じ値を与えられる。
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { REPO_ROOT, config } from '../config.js';
import { encryptSecret, hashPassword, randomToken, sha256Hex } from '../auth/crypto.js';
import { newTotpSecret } from '../auth/totp.js';
import { buildSearchKey } from '@raylow/japanese-text';
import { blobStore as blobs } from '../services/blobs.js';
import { closePools } from '../db/pool.js';

const client = new pg.Client({ connectionString: config.dbServiceUrl });
await client.connect();
await client.query('BEGIN');
await client.query('SET LOCAL ROLE service_role');

// デモ資格情報の上書き（配備時に環境変数で渡す。未設定ならユーザーごとにランダム生成）
const demoPasswordEnv = process.env.SEED_DEMO_PASSWORD?.trim() || null;
const demoTotpEnv = process.env.SEED_DEMO_TOTP_SECRET?.trim().toUpperCase() || null;
if (demoPasswordEnv && demoPasswordEnv.length < 12) throw new Error('SEED_DEMO_PASSWORD は 12 文字以上にしてください');
if (demoTotpEnv && !/^[A-Z2-7]{16,64}$/.test(demoTotpEnv)) throw new Error('SEED_DEMO_TOTP_SECRET は base32（A-Z2-7、16〜64 文字）にしてください');
const demoPassword = () => demoPasswordEnv ?? randomToken(12);
const demoTotpSecret = () => demoTotpEnv ?? newTotpSecret();
const credentialsFromEnv = demoPasswordEnv != null || demoTotpEnv != null;

const already = await client.query(`SELECT 1 FROM public.organizations WHERE name_raw = '青葉法律事務所'`);
if (already.rowCount) {
  console.log('seed: 既に投入済みです（db:reset で再作成できます）');
  await client.query('ROLLBACK');
  await client.end();
  process.exit(0);
}

interface SeedUser { key: string; email: string; name: string; role: 'admin' | 'lawyer' | 'staff'; orgKey: 'aoba' | 'minato'; password: string; totpSecret: string; id?: string }
const users: SeedUser[] = [
  { key: 'aoba_admin', email: 'admin@aoba.example', name: '青葉 事務局（管理者）', role: 'admin', orgKey: 'aoba', password: demoPassword(), totpSecret: demoTotpSecret() },
  { key: 'lawyerA', email: 'hanako@aoba.example', name: '青葉 花子', role: 'lawyer', orgKey: 'aoba', password: demoPassword(), totpSecret: demoTotpSecret() },
  { key: 'lawyerB', email: 'ken@aoba.example', name: '白川 健', role: 'lawyer', orgKey: 'aoba', password: demoPassword(), totpSecret: demoTotpSecret() },
  { key: 'staff', email: 'jimu@aoba.example', name: '事務 太郎', role: 'staff', orgKey: 'aoba', password: demoPassword(), totpSecret: demoTotpSecret() },
  { key: 'minato_lawyer', email: 'lawyer@minato.example', name: '港 一郎', role: 'lawyer', orgKey: 'minato', password: demoPassword(), totpSecret: demoTotpSecret() },
  { key: 'minato_admin', email: 'admin@minato.example', name: '港 事務局', role: 'admin', orgKey: 'minato', password: demoPassword(), totpSecret: demoTotpSecret() },
];

const orgs = {
  aoba: (await client.query<{ id: string }>(`INSERT INTO public.organizations (name_raw, status) VALUES ('青葉法律事務所', 'active') RETURNING id`)).rows[0]!.id,
  minato: (await client.query<{ id: string }>(`INSERT INTO public.organizations (name_raw, status) VALUES ('港みなと法律事務所', 'active') RETURNING id`)).rows[0]!.id,
};

for (const u of users) {
  const r = await client.query<{ id: string }>('INSERT INTO public.app_users (email_raw, email_key, display_name_raw) VALUES ($1, $2, $3) RETURNING id', [u.email, u.email.toLowerCase(), u.name]);
  u.id = r.rows[0]!.id;
  await client.query('INSERT INTO public.memberships (org_id, user_id, role, status) VALUES ($1, $2, $3, $4)', [orgs[u.orgKey], u.id, u.role, 'active']);
  await client.query('INSERT INTO private.local_credentials (user_id, password_hash) VALUES ($1, $2)', [u.id, await hashPassword(u.password)]);
  await client.query('INSERT INTO private.mfa_totp (user_id, secret_enc, enrolled_at) VALUES ($1, $2, now())', [u.id, encryptSecret(u.totpSecret)]);
}
const U = Object.fromEntries(users.map((u) => [u.key, u.id!])) as Record<'aoba_admin' | 'lawyerA' | 'lawyerB' | 'staff' | 'minato_lawyer' | 'minato_admin', string>;

// 事務所プロファイル
const office = await client.query<{ id: string }>(
  `INSERT INTO public.office_profiles (org_id, revision, name_raw, address_raw, postcode_raw, phone_raw, fax_raw, email_raw, is_current, created_by) VALUES ($1, 1, '青葉法律事務所', '東京都千代田区霞が関一丁目１番１号\u3000青葉ビル５階', '１００－００１３', '０３－１２３４－５６７８', '０３－１２３４－５６７９', 'info@aoba.example', true, $2) RETURNING id`,
  [orgs.aoba, U.aoba_admin],
);
await client.query(`INSERT INTO public.office_profiles (org_id, revision, name_raw, address_raw, postcode_raw, phone_raw, is_current, created_by) VALUES ($1, 1, '港みなと法律事務所', '神奈川県横浜市中区港町１－１', '231-0017', '045-000-0000', true, $2)`, [orgs.minato, U.minato_admin]);

// 弁護士
const lawyerA = (await client.query<{ id: string }>(`INSERT INTO public.lawyers (org_id, user_id, name_raw, kana, office_profile_id, title_raw, registration_number_raw, search_key, created_by) VALUES ($1, $2, '青葉 花子', 'あおば はなこ', $3, '弁護士', '００００１', $4, $5) RETURNING id`, [orgs.aoba, U.lawyerA, office.rows[0]!.id, buildSearchKey('青葉 花子 あおば はなこ').key, U.aoba_admin])).rows[0]!.id;
const lawyerB = (await client.query<{ id: string }>(`INSERT INTO public.lawyers (org_id, user_id, name_raw, kana, office_profile_id, title_raw, registration_number_raw, search_key, created_by) VALUES ($1, $2, '白川 健', 'しらかわ けん', $3, '弁護士', '００００２', $4, $5) RETURNING id`, [orgs.aoba, U.lawyerB, office.rows[0]!.id, buildSearchKey('白川 健 しらかわ けん').key, U.aoba_admin])).rows[0]!.id;
await client.query(`INSERT INTO public.lawyers (org_id, user_id, name_raw, kana, title_raw, search_key, created_by) VALUES ($1, $2, '港 一郎', 'みなと いちろう', '弁護士', $3, $4)`, [orgs.minato, U.minato_lawyer, buildSearchKey('港 一郎').key, U.minato_admin]);

// 連絡先（同姓同名の佐藤一郎 2 名）
async function contact(orgId: string, type: string, name: string, kana: string, orgName: string, address: string, postcode: string, channels: Record<string, string>, createdBy: string): Promise<string> {
  const key = buildSearchKey([name, kana, orgName, address].join(' ')).key;
  const r = await client.query<{ id: string }>(`INSERT INTO public.contacts (org_id, type, name_raw, kana, organization_name_raw, address_raw, postcode_raw, channels_json, checked_at, search_key, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now(), $9, $10) RETURNING id`, [orgId, type, name, kana, orgName, address, postcode, JSON.stringify(channels), key, createdBy]);
  await client.query('INSERT INTO public.contact_versions (org_id, contact_id, revision, snapshot, created_by) SELECT org_id, id, version, to_jsonb(c), $2 FROM public.contacts c WHERE id = $1', [r.rows[0]!.id, createdBy]);
  return r.rows[0]!.id;
}
const sato1 = await contact(orgs.aoba, 'lawyer', '佐藤 一郎', 'さとう いちろう', '第一法律事務所', '東京都中央区日本橋一丁目２番３号\u3000日本橋第一ビル８階', '１０３－００２７', { phone: '０３－２２２２－０００１', fax: '０３－２２２２－０００２' }, U.staff);
const sato2 = await contact(orgs.aoba, 'lawyer', '佐藤 一郎', 'さとう いちろう', '佐藤総合法律事務所', '大阪府大阪市北区西天満二丁目４番５号\u3000西天満ビル３階', '５３０－００４７', { phone: '０６－３３３３－０００１' }, U.staff);
const midori = await contact(orgs.aoba, 'organization', '株式会社ミドリ商事', 'かぶしきがいしゃみどりしょうじ', '', '東京都港区芝一丁目１番１号', '１０５－００１４', { phone: '０３－４４４４－０００１', email: 'legal@midori.example' }, U.staff);
const takahashi = await contact(orgs.aoba, 'person', '髙橋\u3000太郎', 'たかはし たろう', '', '東京都世田谷区成城六丁目７番８号', '１５７－００６６', {}, U.staff);
const yamada = await contact(orgs.aoba, 'person', '山田 花子', 'やまだ はなこ', '', '千葉県船橋市本町１－２－３', '２７３－０００５', {}, U.staff);
const kawasaki = await contact(orgs.aoba, 'organization', '﨑山建設株式会社', 'さきやまけんせつ', '', '埼玉県さいたま市浦和区高砂３丁目', '３３０－００６３', {}, U.staff);
const midoriRep = await contact(orgs.aoba, 'person', '緑川 一郎', 'みどりかわ いちろう', '株式会社ミドリ商事（代表取締役）', '東京都港区芝一丁目１番１号', '１０５－００１４', {}, U.staff);
await contact(orgs.minato, 'person', '港 顧客', 'みなと こきゃく', '', '横浜市西区', '', {}, U.minato_admin);

// 案件
async function matter(orgId: string, title: string, caseNo: string, court: string, dept: string, scope: string, lead: string | null, createdBy: string, acceptance: 'confirmed' | 'unconfirmed', checkedBy: string | null): Promise<string> {
  const r = await client.query<{ id: string }>(
    `INSERT INTO public.matters (org_id, title_raw, case_number_raw, court_raw, court_department_raw, scope_raw, lead_lawyer_id, acceptance_status, acceptance_checked_by, acceptance_checked_at, search_key, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CASE WHEN $9::uuid IS NULL THEN NULL ELSE now() END, $10, $11) RETURNING id`,
    [orgId, title, caseNo, court, dept, scope, lead, acceptance, checkedBy, buildSearchKey(`${title} ${caseNo} ${court}`).key, createdBy],
  );
  return r.rows[0]!.id;
}
const m1 = await matter(orgs.aoba, '売買代金請求事件（株式会社ミドリ商事 対 髙橋太郎）', '令和８年（ワ）第１２３４号', '東京地方裁判所', '民事第１部', '売買代金１，２００，０００円の請求に関する交渉および訴訟', lawyerA, U.lawyerA, 'confirmed', U.lawyerA);
const m2 = await matter(orgs.aoba, '貸金返還請求事件（山田花子）', '', '', '', '貸金返還請求に関する交渉', lawyerA, U.lawyerA, 'unconfirmed', null);
const m3 = await matter(orgs.aoba, '請負代金請求事件（﨑山建設株式会社）', '令和８年（ワ）第５６７８号', '大阪地方裁判所', '第３民事部', '請負代金請求訴訟の被告側対応', lawyerB, U.lawyerB, 'confirmed', U.lawyerB);
const mMinato = await matter(orgs.minato, '港事務所の案件（他 org）', '', '', '', '', null, U.minato_lawyer, 'unconfirmed', null);

for (const [mid, uids] of [[m1, [U.lawyerA, U.lawyerB, U.staff]], [m2, [U.lawyerA, U.staff]], [m3, [U.lawyerB, U.lawyerA, U.staff]]] as Array<[string, string[]]>) {
  for (const uid of uids) await client.query('INSERT INTO public.matter_members (matter_id, user_id, org_id, can_edit, approved_by, created_by) VALUES ($1, $2, $3, true, $4, $4)', [mid, uid, orgs.aoba, uids[0]]);
}
await client.query('INSERT INTO public.matter_members (matter_id, user_id, org_id, can_edit, approved_by, created_by) VALUES ($1, $2, $3, true, $2, $2)', [mMinato, U.minato_lawyer, orgs.minato]);
// 別案件 barrier: lawyerB は m2 を閲覧不可
await client.query(`INSERT INTO public.matter_barriers (matter_id, user_id, org_id, reason, created_by) VALUES ($1, $2, $3, '利益相反の可能性（デモ用）', $4)`, [m2, U.lawyerB, orgs.aoba, U.lawyerA]);

// 当事者・代理人（party と agent は別関係）
async function party(mid: string, cid: string, role: string, rep: string | null = null): Promise<string> {
  return (await client.query<{ id: string }>('INSERT INTO public.matter_parties (org_id, matter_id, contact_id, role, representative_id, created_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id', [orgs.aoba, mid, cid, role, rep, U.staff])).rows[0]!.id;
}
await party(m1, midori, 'client', midoriRep);
const p1opp = await party(m1, takahashi, 'opponent');
await client.query('INSERT INTO public.matter_agents (org_id, matter_id, lawyer_contact_id, represented_party_id, valid_from, created_by) VALUES ($1, $2, $3, $4, current_date, $5)', [orgs.aoba, m1, sato1, p1opp, U.staff]);
await party(m2, yamada, 'client');
await party(m3, kawasaki, 'opponent');
const p3client = await party(m3, midori, 'client');
// 同姓同名の別の佐藤一郎は別案件(m3)で「依頼者側」ではなく相手方（﨑山建設）の代理人
const p3opp = (await client.query<{ id: string }>('SELECT id FROM public.matter_parties WHERE matter_id = $1 AND contact_id = $2', [m3, kawasaki])).rows[0]!.id;
await client.query('INSERT INTO public.matter_agents (org_id, matter_id, lawyer_contact_id, represented_party_id, valid_from, created_by) VALUES ($1, $2, $3, $4, current_date, $5)', [orgs.aoba, m3, sato2, p3opp, U.staff]);
void p3client;

// 証拠台帳（m1）
for (const [sym, num, branch, title, author, date] of [['甲', '１', null, '売買契約書', '株式会社ミドリ商事・髙橋太郎', '令和７年４月１日'], ['甲', '２', null, '請求書', '株式会社ミドリ商事', '令和７年６月３０日'], ['甲', '３', '１', '催告書（控え）', '青葉法律事務所', '令和８年１月１５日']] as Array<[string, string, string | null, string, string, string]>) {
  const { parseEvidenceLabel, buildDisplayLabel, canonicalKey, parseJapaneseDate } = await import('@raylow/japanese-text');
  const label = buildDisplayLabel(sym, num, branch);
  const parsed = parseEvidenceLabel(label);
  const d = parseJapaneseDate(date);
  await client.query(`INSERT INTO public.evidence (org_id, matter_id, symbol_raw, number_raw, branch_raw, canonical_number, display_label, title_raw, author_raw, date_raw, date_iso, original_copy, proof_purpose_raw, status, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'copy', '', 'confirmed', $12)`, [orgs.aoba, m1, sym, num, branch, canonicalKey(parsed.canonical!.symbol, parsed.canonical!.number, parsed.canonical!.branch), label, title, author, date, d.precision === 'day' ? d.iso : null, U.staff]);
}

// 文例
const ph = await client.query<{ id: string }>(`INSERT INTO public.phrase_libraries (org_id, title, category, template_kind, created_by) VALUES ($1, '受任通知 導入文（サンプル）', '受任通知', 'T01_engagement_notice', $2) RETURNING id`, [orgs.aoba, U.lawyerA]);
const phv = await client.query<{ id: string }>(`INSERT INTO public.phrase_versions (org_id, phrase_id, revision, body_raw, status, created_by) VALUES ($1, $2, 1, '当職は、貴殿が代理されている相手方との間の下記案件について、依頼者から委任を受けましたので、ご通知申し上げます。（サンプル文例・要確認）', 'draft', $3) RETURNING id`, [orgs.aoba, ph.rows[0]!.id, U.lawyerA]);
await client.query('UPDATE public.phrase_libraries SET current_version_id = $2 WHERE id = $1', [ph.rows[0]!.id, phv.rows[0]!.id]);

// 20 書式デモ（sample_only=true、published。所内承認版ではない）
const demoRoot = path.join(REPO_ROOT, 'templates', 'demo');
const inspector = path.join(REPO_ROOT, 'workers', 'documents', 'inspect_docx.py');
let templateCount = 0;
if (fs.existsSync(demoRoot)) {
  for (const dir of fs.readdirSync(demoRoot).filter((d) => /^T\d{2}_/.test(d)).sort()) {
    const base = path.join(demoRoot, dir);
    const docxPath = path.join(base, 'template.docx');
    const schemaPath = path.join(base, 'schema.json');
    const provPath = path.join(base, 'provenance.json');
    if (!fs.existsSync(docxPath) || !fs.existsSync(schemaPath)) {
      console.warn(`seed: ${dir} に template.docx/schema.json が無いためスキップ`);
      continue;
    }
    const bytes = fs.readFileSync(docxPath);
    const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8')) as { title?: string; kind?: string; scope?: string };
    const prov = fs.existsSync(provPath) ? (JSON.parse(fs.readFileSync(provPath, 'utf8')) as Record<string, unknown>) : { source: 'RayLaw demo', sampleOnly: true, supervised: false };
    let report: unknown = { ok: true, issues: [{ severity: 'warning', code: 'not_inspected', message: '検査スクリプト未実行' }], tags: [], stats: {} };
    if (fs.existsSync(inspector)) {
      const r = spawnSync('python3', ['-I', inspector, docxPath], { encoding: 'utf8', timeout: 120_000 });
      if (r.status === 0 && r.stdout) {
        try { report = JSON.parse(r.stdout); } catch { /* keep default */ }
      } else {
        console.warn(`seed: inspector failed for ${dir}: ${r.stderr?.slice(0, 300)}`);
      }
    }
    const rep = report as { ok?: boolean; issues?: Array<{ severity: string; message: string }> };
    if (rep.ok === false) console.warn(`seed: ${dir} inspection errors: ${rep.issues?.filter((i) => i.severity === 'error').map((i) => i.message).join('; ')}`);
    for (const [orgId, creator, approver] of [[orgs.aoba, U.aoba_admin, U.lawyerA]] as Array<[string, string, string]>) {
      const key = randomUUID();
      await blobs.put(bytes, key);
      const sha = sha256Hex(bytes);
      const f = await client.query<{ id: string }>(`INSERT INTO public.files (org_id, scope, storage_key, original_name_raw, mime, size, sha256, scan_status, confidential, created_by) VALUES ($1, 'template', $2, $3, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', $4, $5, 'clean', false, $6) RETURNING id`, [orgId, key, `${dir}.docx`, bytes.length, sha, creator]);
      await client.query(`INSERT INTO public.file_versions (org_id, file_id, revision, storage_key, sha256, size, kind, created_by) VALUES ($1, $2, 1, $3, $4, $5, 'original', $6)`, [orgId, f.rows[0]!.id, key, sha, bytes.length, creator]);
      const t = await client.query<{ id: string }>('INSERT INTO public.templates (org_id, name, kind, created_by) VALUES ($1, $2, $3, $4) RETURNING id', [orgId, schema.title ?? dir, schema.kind ?? dir, creator]);
      const tv = await client.query<{ id: string }>(
        `INSERT INTO public.template_versions (org_id, template_id, revision, docx_file_id, docx_sha256, field_schema, kind, scope, status, sample_only, approved_by, approved_at, renderer_profile_id, inspection_report, provenance, source_url, checked_at, license_note, created_by)
         VALUES ($1, $2, 1, $3, $4, $5, $6, $7, 'published', true, $8, now(), '00000000-0000-4000-8000-000000000011', $9, $10, NULL, '2026-10-06', 'RayLaw デモ（架空・自作）。監修済みではない。', $11) RETURNING id`,
        [orgId, t.rows[0]!.id, f.rows[0]!.id, sha, JSON.stringify(schema), schema.kind ?? dir, schema.scope ?? 'negotiation', approver, JSON.stringify(report), JSON.stringify(prov), creator],
      );
      await client.query('UPDATE public.templates SET active_version_id = $2 WHERE id = $1', [t.rows[0]!.id, tv.rows[0]!.id]);
      templateCount++;
    }
  }
}

await client.query(`INSERT INTO public.audit_events (org_id, actor_id, actor_role, action, target_type, details) VALUES ($1, $2, 'admin', 'seed.applied', 'organization', $3)`, [orgs.aoba, U.aoba_admin, JSON.stringify({ templates: templateCount, note: 'demo seed（架空データ）' })]);
await client.query('COMMIT');
await client.end();
await closePools();

const credPath = process.env.SEED_CREDENTIALS_PATH ? path.resolve(REPO_ROOT, process.env.SEED_CREDENTIALS_PATH) : path.join(REPO_ROOT, '.data', 'seed-credentials.json');
fs.mkdirSync(path.dirname(credPath), { recursive: true });
fs.writeFileSync(credPath, JSON.stringify({ generatedAt: new Date().toISOString(), note: 'デモ専用。公開 repo に含めない（.gitignore 対象）', users: users.map((u) => ({ key: u.key, email: u.email, role: u.role, org: u.orgKey, password: u.password, totpSecret: u.totpSecret })), ids: { orgs, matters: { m1, m2, m3, mMinato }, contacts: { sato1, sato2, midori, takahashi, yamada, kawasaki }, lawyers: { lawyerA, lawyerB } } }, null, 2), { mode: 0o600 });
console.log(`seed: 完了。書式 ${templateCount} 件。資格情報は ${credPath} に保存しました（表示は一度だけ）`);
// 環境変数で与えた値はログに出さない（配備環境のログへ漏らさない）
for (const u of users) console.log(`  ${u.key.padEnd(14)} ${u.email.padEnd(28)} role=${u.role.padEnd(6)} password=${credentialsFromEnv ? '(SEED_DEMO_PASSWORD)' : u.password} totp=${credentialsFromEnv ? '(SEED_DEMO_TOTP_SECRET)' : u.totpSecret}`);
