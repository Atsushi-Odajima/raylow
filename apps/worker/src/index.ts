import { config } from './config.js';
import { pool } from './db.js';
import { drainQueue, log, processOnce, TYPES } from './worker.js';

let stopping = false;
process.on('SIGINT', () => (stopping = true));
process.on('SIGTERM', () => (stopping = true));

if (process.env.RAYLOW_WORKER_ONESHOT === 'true') {
  const n = await drainQueue();
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
