import type { FastifyInstance } from 'fastify';
import type { Job } from '@raylow/contracts';
import { withUserTx } from '../db/pool.js';
import { notFound } from '../errors.js';
import { requireActor } from '../plugins/auth.js';
import { ok } from '../lib/reply.js';
import { audit } from '../services/audit.js';

type Row = Record<string, unknown>;

const RETRYABLE = new Set(['timeout', 'lease_expired', 'converter_unavailable', 'scanner_unavailable', 'transient']);

export function jobOut(r: Row): Job {
  const payload = (r.payload as Record<string, unknown>) ?? {};
  const errorCode = (r.error_code as string | null) ?? null;
  let fixLink: string | null = null;
  if (r.state === 'failed') {
    if (typeof payload.draftId === 'string') fixLink = `/drafts/${payload.draftId}/edit`;
    else if (typeof payload.templateVersionId === 'string') fixLink = `/templates/import`;
    else if (typeof payload.packetId === 'string') fixLink = `/packets/${payload.packetId}`;
  }
  return {
    id: r.id as string, orgId: r.org_id as string, matterId: (r.matter_id as string | null) ?? null, type: r.type as string, state: r.state as Job['state'], attempt: r.attempt as number, maxAttempts: r.max_attempts as number, progress: (r.progress_json as Record<string, unknown>) ?? {}, errorCode, errorMessage: (r.error_message as string | null) ?? null, result: (r.result as Record<string, unknown> | null) ?? null,
    cancelRequested: r.cancel_requested as boolean, runAfter: r.run_after as string, createdAt: r.created_at as string, updatedAt: r.updated_at as string, retryable: errorCode ? RETRYABLE.has(errorCode) : false, fixLink,
  };
}

export async function jobRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/jobs/:id', async (req, reply) => {
    const actor = requireActor(req);
    const { id } = req.params as { id: string };
    const j = await withUserTx(actor, async (tx) => {
      const r = await tx.query<Row>('SELECT * FROM public.jobs WHERE id = $1', [id]);
      if (!r.rows[0]) throw notFound();
      return jobOut(r.rows[0]);
    });
    return ok(req, reply, j);
  });
  app.post('/api/jobs/:id/cancel', async (req, reply) => {
    const actor = requireActor(req);
    const { id } = req.params as { id: string };
    const j = await withUserTx(actor, async (tx) => {
      const r = await tx.query<Row>(`UPDATE public.jobs SET cancel_requested = true WHERE id = $1 AND state IN ('queued','running') RETURNING *`, [id]);
      if (!r.rows[0]) {
        const cur = await tx.query<Row>('SELECT * FROM public.jobs WHERE id = $1', [id]);
        if (!cur.rows[0]) throw notFound();
        return jobOut(cur.rows[0]);
      }
      await audit(tx, actor, { action: 'job.cancel_requested', targetType: 'job', targetId: id, matterId: (r.rows[0].matter_id as string | null) ?? null });
      return jobOut(r.rows[0]);
    });
    return ok(req, reply, j);
  });
}
