// マイグレーション適用（素の Postgres 用。Supabase local では `npx supabase db reset` が同じ SQL を適用する）
import pg from 'pg';
import { adminUrl, listMigrations } from './db-lib.mjs';

const client = new pg.Client({ connectionString: adminUrl() });
await client.connect();
try {
  await client.query(`CREATE TABLE IF NOT EXISTS public._raylow_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
  const applied = new Set((await client.query('SELECT name FROM public._raylow_migrations')).rows.map((r) => r.name));
  let n = 0;
  for (const m of listMigrations()) {
    if (applied.has(m.name)) continue;
    process.stdout.write(`applying ${m.name} ... `);
    await client.query('BEGIN');
    try {
      await client.query(m.sql);
      await client.query('INSERT INTO public._raylow_migrations (name) VALUES ($1)', [m.name]);
      await client.query('COMMIT');
      console.log('ok');
      n++;
    } catch (e) {
      await client.query('ROLLBACK');
      console.log('FAILED');
      throw e;
    }
  }
  // ログインロール authenticator（Supabase には既存）。素の Postgres のみ作成。
  const pw = process.env.DB_AUTHENTICATOR_PASSWORD;
  const r = await client.query(`SELECT 1 FROM pg_roles WHERE rolname = 'authenticator'`);
  if (r.rowCount === 0) {
    if (!pw) throw new Error('DB_AUTHENTICATOR_PASSWORD が未設定です（authenticator ロール作成に必要）');
    await client.query(`CREATE ROLE authenticator LOGIN NOINHERIT PASSWORD '${pw.replace(/'/g, "''")}'`);
    await client.query('GRANT anon, authenticated, service_role TO authenticator');
    console.log('created role authenticator');
  } else {
    // 管理対象 Postgres（Supabase 等）では authenticator の所属が既に揃っており、再 GRANT に ADMIN 権限が無いことがある
    const have = new Set(
      (
        await client.query(
          `SELECT r.rolname FROM pg_auth_members am JOIN pg_roles r ON r.oid = am.roleid JOIN pg_roles m ON m.oid = am.member
           WHERE m.rolname = 'authenticator' AND r.rolname IN ('anon', 'authenticated', 'service_role')`,
        )
      ).rows.map((x) => x.rolname),
    );
    const missing = ['anon', 'authenticated', 'service_role'].filter((x) => !have.has(x));
    if (missing.length) {
      try {
        await client.query(`GRANT ${missing.join(', ')} TO authenticator`);
      } catch (e) {
        console.warn(`warning: authenticator への GRANT ${missing.join(', ')} に失敗しました（${e.message}）。管理対象 Postgres では既存のロール設定を使ってください`);
      }
    }
  }
  console.log(`migrations applied: ${n}`);
} finally {
  await client.end();
}
