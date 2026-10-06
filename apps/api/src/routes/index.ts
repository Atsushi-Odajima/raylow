import type { FastifyInstance } from 'fastify';
import { authRoutes } from './auth.js';
import { miscRoutes } from './misc.js';
import { masterRoutes } from './masters.js';
import { matterRoutes } from './matters.js';
import { templateRoutes } from './templates.js';
import { draftRoutes } from './drafts.js';
import { reviewRoutes } from './reviews.js';
import { fileRoutes } from './files.js';
import { evidenceRoutes } from './evidence.js';
import { batchRoutes } from './batches.js';
import { packetRoutes } from './packets.js';
import { jobRoutes } from './jobs.js';
import { exportRoutes } from './exports.js';

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  await authRoutes(app);
  await miscRoutes(app);
  await masterRoutes(app);
  await matterRoutes(app);
  await templateRoutes(app);
  await draftRoutes(app);
  await reviewRoutes(app);
  await fileRoutes(app);
  await evidenceRoutes(app);
  await batchRoutes(app);
  await packetRoutes(app);
  await jobRoutes(app);
  await exportRoutes(app);
}
