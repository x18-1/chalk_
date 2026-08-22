import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const rootEnvPath = resolve(scriptDirectory, '../../../.env');
if (existsSync(rootEnvPath)) process.loadEnvFile(rootEnvPath);

const [command, ...arguments_] = process.argv.slice(2);
if (!command) {
  console.error('Expected a Next.js command');
  process.exit(1);
}

if ((command === 'dev' || command === 'start') && process.env.WEB_PORT) {
  arguments_.push('--port', process.env.WEB_PORT);
}

const nextCli = resolve(scriptDirectory, '../node_modules/next/dist/bin/next');
const result = spawnSync(process.execPath, [nextCli, command, ...arguments_], {
  env: process.env,
  stdio: 'inherit',
});

if (result.error) throw result.error;
process.exit(result.status ?? 1);
