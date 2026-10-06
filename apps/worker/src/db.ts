import pg from 'pg';
import { config } from './config.js';

pg.types.setTypeParser(20, (v) => v);
pg.types.setTypeParser(1184, (v) => new Date(v).toISOString());
pg.types.setTypeParser(1082, (v) => v);

export const pool = new pg.Pool({ connectionString: config.dbUrl, max: 4, application_name: `raylow-worker-${config.workerId}` });
export type Tx = pg.PoolClient;

/** worker は service_role。job の org/matter を再確認する責任は各 handler にある。 */
export async function withServiceTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query('SET LOCAL ROLE service_role');
    const out = await fn(c);
    await c.query('COMMIT');
    return out;
  } catch (e) {
    try { await c.query('ROLLBACK'); } catch { /* ignore */ }
    throw e;
  } finally {
    c.release();
  }
}
