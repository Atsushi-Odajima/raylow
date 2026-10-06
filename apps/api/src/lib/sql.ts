import type { Tx } from '../db/pool.js';
import { notFound, versionConflict } from '../errors.js';

/** expectedVersion 付き更新。0 行なら現在版を調べて 409 / 404 を返す。 */
export async function updateWithVersion<T extends { version: number }>(tx: Tx, sql: string, params: unknown[], table: string, id: string, expectedVersion: number): Promise<T> {
  const r = await tx.query<T>(sql, params);
  if (r.rows[0]) return r.rows[0];
  const cur = await tx.query<{ version: number }>(`SELECT version FROM public.${table} WHERE id = $1`, [id]);
  if (!cur.rows[0]) throw notFound();
  if (cur.rows[0].version !== expectedVersion) throw versionConflict(cur.rows[0].version);
  throw notFound();
}

export function camel<T = Record<string, unknown>>(row: Record<string, unknown>): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) out[k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())] = v;
  return out as T;
}
