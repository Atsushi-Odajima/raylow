import { buildApp } from './app.js';
import { config } from './config.js';
import { closePools } from './db/pool.js';

const app = await buildApp();
try {
  await app.listen({ port: config.port, host: config.host });
  app.log.info(`RayLaw API listening on http://${config.host}:${config.port} (auth=${config.authProvider}, blobs=${config.blobStore})`);
} catch (e) {
  app.log.error(e);
  process.exit(1);
}
const shutdown = async () => {
  await app.close();
  await closePools();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
