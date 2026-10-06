import type { Actor, Tx } from '../db/pool.js';

export interface AuditInput {
  action: string;
  targetType: string;
  targetId?: string | null;
  targetVersion?: number | null;
  targetHash?: string | null;
  matterId?: string | null;
  /** 本文・token・secret・相手先一覧を入れない */
  details?: Record<string, unknown>;
}

/** 監査 + outbox を業務変更と同一 transaction で記録する（AC27）。 */
export async function audit(tx: Tx, actor: Actor, input: AuditInput): Promise<void> {
  await tx.query(
    `INSERT INTO public.audit_events (org_id, matter_id, actor_id, actor_role, action, target_type, target_id, target_version, target_hash, request_id, details)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [actor.orgId, input.matterId ?? null, actor.userId, actor.role, input.action, input.targetType, input.targetId ?? null, input.targetVersion ?? null, input.targetHash ?? null, actor.requestId, JSON.stringify(input.details ?? {})],
  );
  await tx.query(`INSERT INTO public.outbox (org_id, event_type, payload_ref, payload) VALUES ($1, $2, $3, $4)`, [
    actor.orgId,
    input.action,
    input.targetId ?? null,
    JSON.stringify({ targetType: input.targetType, targetId: input.targetId ?? null, matterId: input.matterId ?? null, requestId: actor.requestId }),
  ]);
}
