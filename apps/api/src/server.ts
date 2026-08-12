import { resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';

// Keep local development compatible with the repository's historical env filename.
loadDotenv({ path: resolve(process.cwd(), '../../.env ') });
loadDotenv({ path: resolve(process.cwd(), '../../.env') });

const [{ buildApi }, { loadConfig }] = await Promise.all([
  import('./app'),
  import('./config'),
]);

const config = loadConfig();
const app = await buildApi({ config });

await app.listen({ host: config.host, port: config.port });
app.log.info({ host: config.host, port: config.port }, 'Chalk API listening');

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'Shutting down Chalk API');
  await app.close();
  const { closeDb } = await import('./db/client');
  await closeDb();
  process.exit(0);
};

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));
