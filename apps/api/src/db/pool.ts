import pg from 'pg';
import { config } from '../config.js';

// bigint/numeric を文字列のまま返す（金額は decimal string）
pg.types.setTypeParser(20, (v) => v);
pg.types.setTypeParser(1700, (v) => v);
// timestamptz は ISO 文字列（UTC）で返す
pg.types.setTypeParser(1184, (v) => new Date(v).toISOString());
pg.types.setTypeParser(1082, (v) => v); // date はそのまま

export const appPool = new pg.Pool({ connectionString: config.dbAppUrl, max: 20, idleTimeoutMillis: 30_000, application_name: 'raylow-api' });
export const servicePool = new pg.Pool({ connectionString: config.dbServiceUrl, max: 5, idleTimeoutMillis: 30_000, application_name: 'raylow-api-service' });

export type Tx = pg.PoolClient;

export interface Actor {
  userId: string;
  orgId: string;
  role: 'admin' | 'lawyer' | 'staff';
  requestId: string;
}

/**
 * 本人 claims を DB へ渡して RLS を適用する transaction。
 * SET LOCAL ROLE authenticated + request.jwt.claims(sub)。client の role/actorId を信頼しない（session から決定）。
 */
export async function withUserTx<T>(actor: Actor, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const client = await appPool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL ROLE authenticated');
    await client.query("SELECT set_config('request.jwt.claims', $1, true), set_config('app.request_id', $2, true), set_config('app.org_id', $3, true)", [
      JSON.stringify({ sub: actor.userId, role: 'authenticated', org_id: actor.orgId, app_role: actor.role }),
      actor.requestId,
      actor.orgId,
    ]);
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* ignore */
    }
    throw e;
  } finally {
    client.release();
  }
}

/** service_role（BYPASSRLS）。session 管理・worker 向け job 投入など、BFF 内部処理のみ。 */
export async function withServiceTx<T>(fn: (tx: Tx) => Promise<T>, requestId = ''): Promise<T> {
  const client = await servicePool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL ROLE service_role');
    if (requestId) await client.query("SELECT set_config('app.request_id', $1, true)", [requestId]);
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* ignore */
    }
    throw e;
  } finally {
    client.release();
  }
}

export async function closePools(): Promise<void> {
  await Promise.all([appPool.end(), servicePool.end()]);
}
