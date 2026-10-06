/**
 * RayLaw render worker（§9）
 * job claim = FOR UPDATE SKIP LOCKED、lease 120 秒 / heartbeat 30 秒、最大 3 回、失敗後 30/120 秒で再試行。
 * retry 可能なのは timeout 等。書式エラーは自動再試行せず修正導線へ。
 */
import pino from 'pino';
import { JOB_HEARTBEAT_SECONDS, JOB_LEASE_SECONDS, JOB_RETRY_DELAYS_SECONDS } from '@raylow/domain';
import { config } from './config.js';
import { pool, withServiceTx } from './db.js';
import { JobFailure, type JobContext, type JobHandler, type JobRow } from './jobs/types.js';
import { renderDraftJob, testTemplateJob } from './jobs/render.js';
import { inspectTemplateJob } from './jobs/inspect.js';
import { scanFileJob } from './jobs/scan.js';
import { renderPacketJob } from './jobs/packet.js';
import { exportJob } from './jobs/export.js';
import { externalEditJob } from './jobs/externalEdit.js';
import fs from 'node:fs';

const log = pino({ level: config.logLevel, redact: ['payload.snapshot', 'payload.ast'] });
fs.mkdirSync(config.tmpDir, { recursive: true });

const handlers: Record<string, JobHandler> = {
  render_draft: renderDraftJob,
  render_final: renderDraftJob,
  test_template: testTemplateJob,
  inspect_template: inspectTemplateJob,
  scan_file: scanFileJob,
  render_packet: renderPacketJob,
  export: exportJob,
  external_edit_ingest: externalEditJob,
};
const TYPES = Object.keys(handlers);

async function claim(): Promise<JobRow | null> {
  return withServiceTx(async (tx) => {
    await tx.query('SELECT app.requeue_expired_jobs()');
    const r = await tx.query<JobRow>('SELECT * FROM app.claim_job($1, $2::text[], $3)', [config.workerId, TYPES, JOB_LEASE_SECONDS]);
    return r.rows[0] ?? null;
  });
}

async function heartbeat(job: JobRow, progress: Record<string, unknown> | null): Promise<boolean> {
  return withServiceTx(async (tx) => {
    const r = await tx.query<{ ok: boolean }>('SELECT app.heartbeat_job($1, $2, $3, $4) AS ok', [job.id, config.workerId, JOB_LEASE_SECONDS, progress ? JSON.stringify(progress) : null]);
    const c = await tx.query<{ cancel_requested: boolean }>('SELECT cancel_requested FROM public.jobs WHERE id = $1', [job.id]);
    return (r.rows[0]?.ok ?? false) && !(c.rows[0]?.cancel_requested ?? false);
  });
}

async function runOne(job: JobRow): Promise<void> {
  const handler = handlers[job.type];
  if (!handler) {
    await withServiceTx((tx) => tx.query(`UPDATE public.jobs SET state = 'failed', error_code = 'unknown_type', error_message = $2, lease_until = NULL WHERE id = $1`, [job.id, `未知の job type ${job.type}`]));
    return;
  }
  const started = Date.now();
  let cancelled = false;
  const hb = setInterval(() => {
    void heartbeat(job, null).then((ok) => { if (!ok) cancelled = true; }).catch(() => undefined);
  }, JOB_HEARTBEAT_SECONDS * 1000);
  const ctx: JobContext = {
    job,
    progress: async (p) => {
      const ok = await heartbeat(job, p);
      if (!ok) cancelled = true;
      return ok && !cancelled;
    },
    log: (msg, extra) => log.info({ jobId: job.id, type: job.type, ...extra }, msg),
  };
  try {
    const result = await withServiceTx(async (tx) => {
      // 業務変更と job 完了を同一 transaction で確定（AC27）
      const out = await handler(ctx, tx);
      const upd = await tx.query(`UPDATE public.jobs SET state = 'succeeded', result = $2, lease_until = NULL, progress_json = progress_json || '{"step":"done"}'::jsonb WHERE id = $1 AND state = 'running' AND worker_id = $3`, [job.id, JSON.stringify(out), config.workerId]);
      if (upd.rowCount !== 1) throw new JobFailure('lease_lost', 'job の lease を失いました（他 worker が再実行した可能性）', false);
      return out;
    });
    log.info({ jobId: job.id, type: job.type, ms: Date.now() - started, result: Object.keys(result) }, 'job succeeded');
  } catch (e) {
    const f = e instanceof JobFailure ? e : new JobFailure((e as { code?: string }).code === 'ECONNREFUSED' ? 'transient' : 'internal_error', (e as Error).message ?? String(e), (e as { code?: string }).code === 'ECONNREFUSED');
    const retryable = f.retryable && f.code !== 'cancelled';
    await withServiceTx(async (tx) => {
      const cur = await tx.query<{ attempt: number; max_attempts: number; cancel_requested: boolean; payload: Record<string, unknown> }>('SELECT attempt, max_attempts, cancel_requested, payload FROM public.jobs WHERE id = $1 FOR UPDATE', [job.id]);
      const row = cur.rows[0];
      if (!row) return;
      const willRetry = retryable && row.attempt < row.max_attempts && !row.cancel_requested;
      const delay = JOB_RETRY_DELAYS_SECONDS[Math.min(row.attempt - 1, JOB_RETRY_DELAYS_SECONDS.length - 1)] ?? 120;
      const state = f.code === 'cancelled' || row.cancel_requested ? 'cancelled' : willRetry ? 'queued' : 'failed';
      await tx.query(`UPDATE public.jobs SET state = $2, error_code = $3, error_message = $4, lease_until = NULL, worker_id = NULL, run_after = CASE WHEN $2 = 'queued' THEN now() + make_interval(secs => $5) ELSE run_after END, result = CASE WHEN $2 = 'failed' THEN $6::jsonb ELSE result END WHERE id = $1`, [job.id, state, f.code, f.message.slice(0, 2000), delay, JSON.stringify({ details: f.details })]);
      const bi = row.payload.batchItemId;
      if (typeof bi === 'string' && state !== 'queued') {
        await tx.query(`UPDATE public.batch_items SET status = $2, error_code = $3, error_message = $4, updated_at = now() WHERE id = $1`, [bi, state === 'cancelled' ? 'cancelled' : 'failed', f.code, f.message.slice(0, 500)]);
        await tx.query(`UPDATE public.batches b SET status = CASE WHEN NOT EXISTS (SELECT 1 FROM public.batch_items x WHERE x.batch_id = b.id AND x.status IN ('queued','running')) THEN (CASE WHEN EXISTS (SELECT 1 FROM public.batch_items x WHERE x.batch_id = b.id AND x.status = 'failed') THEN 'partial_failed' ELSE 'succeeded' END) ELSE b.status END WHERE b.id = (SELECT batch_id FROM public.batch_items WHERE id = $1)`, [bi]);
      }
      if (typeof row.payload.draftId === 'string' && job.type === 'render_draft' && state === 'failed') {
        await tx.query(`UPDATE public.drafts SET status = 'draft' WHERE id = $1 AND status = 'rendering'`, [row.payload.draftId]);
      }
      if (typeof row.payload.packetId === 'string' && state !== 'queued') await tx.query(`UPDATE public.packets SET status = 'failed' WHERE id = $1 AND status = 'rendering'`, [row.payload.packetId]);
    });
    log.warn({ jobId: job.id, type: job.type, code: f.code, retryable, ms: Date.now() - started }, `job failed: ${f.message}`);
  } finally {
    clearInterval(hb);
  }
}

/** batch 全体の状態を成功側でも更新 */
async function finalizeBatches(): Promise<void> {
  await withServiceTx((tx) =>
    tx.query(`UPDATE public.batches b SET status = CASE WHEN EXISTS (SELECT 1 FROM public.batch_items x WHERE x.batch_id = b.id AND x.status = 'failed') THEN 'partial_failed' ELSE 'succeeded' END
              WHERE b.status = 'running' AND NOT EXISTS (SELECT 1 FROM public.batch_items x WHERE x.batch_id = b.id AND x.status IN ('queued','running'))`),
  );
}

let stopping = false;
process.on('SIGINT', () => (stopping = true));
process.on('SIGTERM', () => (stopping = true));

export async function processOnce(): Promise<boolean> {
  const job = await claim();
  if (!job) return false;
  log.info({ jobId: job.id, type: job.type, attempt: job.attempt }, 'job claimed');
  await runOne(job);
  await finalizeBatches();
  return true;
}

if (process.env.RAYLOW_WORKER_ONESHOT === 'true') {
  // テスト用: キューが空になるまで処理して終了
  let n = 0;
  while (await processOnce()) n += 1;
  log.info({ processed: n }, 'oneshot done');
  await pool.end();
} else {
  log.info({ workerId: config.workerId, types: TYPES, soffice: config.soffice, fontsDir: config.fontsDir }, 'RayLaw worker started');
  while (!stopping) {
    try {
      const did = await processOnce();
      if (!did) await new Promise((r) => setTimeout(r, config.pollMs));
    } catch (e) {
      log.error({ err: (e as Error).message }, 'worker loop error');
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  await pool.end();
  log.info('worker stopped');
}
