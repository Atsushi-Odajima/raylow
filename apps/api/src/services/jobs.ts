import { createHash } from 'node:crypto';
import { canonicalJson } from '@raylow/domain';
import type { JobType } from '@raylow/contracts';
import type { Actor, Tx } from '../db/pool.js';

export interface EnqueueInput {
  type: JobType;
  matterId?: string | null;
  scopeKey: string;
  payload: Record<string, unknown>;
  maxAttempts?: number;
}

export interface EnqueueResult {
  jobId: string;
  deduplicated: boolean;
}

/** input_hash + operation + scope で重複生成を防ぐ。同一 transaction 内で呼ぶ。 */
export async function enqueueJob(tx: Tx, actor: Actor, input: EnqueueInput): Promise<EnqueueResult> {
  const inputHash = createHash('sha256').update(canonicalJson(input.payload)).digest('hex');
  const existing = await tx.query<{ id: string }>(
    `SELECT id FROM public.jobs WHERE org_id = $1 AND type = $2 AND scope_key = $3 AND input_hash = $4 AND state IN ('queued', 'running') LIMIT 1`,
    [actor.orgId, input.type, input.scopeKey, inputHash],
  );
  if (existing.rows[0]) return { jobId: existing.rows[0].id, deduplicated: true };
  const r = await tx.query<{ id: string }>(
    `INSERT INTO public.jobs (org_id, matter_id, type, scope_key, input_hash, payload, max_attempts, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [actor.orgId, input.matterId ?? null, input.type, input.scopeKey, inputHash, JSON.stringify(input.payload), input.maxAttempts ?? 3, actor.userId],
  );
  return { jobId: r.rows[0]!.id, deduplicated: false };
}
