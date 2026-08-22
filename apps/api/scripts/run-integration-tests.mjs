import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import postgres from 'postgres';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const apiDirectory = resolve(scriptDirectory, '..');
const rootEnvPath = resolve(apiDirectory, '../../.env');
if (existsSync(rootEnvPath)) process.loadEnvFile(rootEnvPath);

const rawTestUrl = process.env.TEST_DATABASE_URL?.trim();
if (!rawTestUrl) {
  console.error('TEST_DATABASE_URL is required for API integration tests.');
  console.error('See docs/runbooks/database-development.md.');
  process.exit(1);
}

let testUrl;
try {
  testUrl = new URL(rawTestUrl);
} catch {
  console.error('TEST_DATABASE_URL must be a valid PostgreSQL URL.');
  process.exit(1);
}

const databaseName = decodeURIComponent(testUrl.pathname.slice(1));
const localHosts = new Set(['127.0.0.1', 'localhost', 'postgres']);
const isPostgres = testUrl.protocol === 'postgres:' || testUrl.protocol === 'postgresql:';
if (!isPostgres || !/^chalk_[a-z0-9_]+_test$/.test(databaseName)) {
  console.error('TEST_DATABASE_URL must target a database named chalk_<worktree>_test.');
  process.exit(1);
}
if (!localHosts.has(testUrl.hostname) && process.env.ALLOW_REMOTE_TEST_DATABASE !== 'true') {
  console.error('Remote test databases require ALLOW_REMOTE_TEST_DATABASE=true.');
  process.exit(1);
}
if (process.env.DATABASE_URL && process.env.DATABASE_URL === rawTestUrl) {
  console.error('TEST_DATABASE_URL must differ from DATABASE_URL.');
  process.exit(1);
}

const adminUrl = new URL(testUrl);
adminUrl.pathname = '/postgres';
const admin = postgres(adminUrl.toString(), { max: 1 });
try {
  const existing = await admin`
    select 1 from pg_database where datname = ${databaseName}
  `;
  if (existing.length === 0) {
    const quotedName = `"${databaseName.replaceAll('"', '""')}"`;
    await admin.unsafe(`create database ${quotedName}`);
    console.log(`Created integration test database ${databaseName}.`);
  }
} finally {
  await admin.end({ timeout: 5 });
}

const testEnvironment = {
  ...process.env,
  NODE_ENV: 'test',
  DATABASE_URL: rawTestUrl,
};

function run(command, arguments_) {
  const result = spawnSync(command, arguments_, {
    cwd: apiDirectory,
    env: testEnvironment,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run('pnpm', ['run', 'db:migrate']);
run('pnpm', ['exec', 'vitest', 'run', 'tests/integration']);
