import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const envPath = resolve(process.cwd(), '.env');
if (existsSync(envPath)) process.loadEnvFile(envPath);

const errors = [];

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) errors.push(`${name} is required`);
  return value;
}

function port(name) {
  const value = required(name);
  const parsed = Number(value);
  if (value && (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535)) {
    errors.push(`${name} must be an integer between 1 and 65535`);
  }
  return parsed;
}

function url(name) {
  const value = required(name);
  if (!value) return undefined;
  try {
    return new URL(value);
  } catch {
    errors.push(`${name} must be a valid URL`);
    return undefined;
  }
}

function urls(name) {
  const value = required(name);
  if (!value) return undefined;
  const parsed = value.split(',').map((item) => item.trim()).filter(Boolean).map((item) => {
    try {
      return new URL(item);
    } catch {
      errors.push(`${name} must contain valid URLs`);
      return undefined;
    }
  });
  return parsed.length && parsed.every(Boolean) ? parsed : undefined;
}

function effectivePort(value, fallback) {
  if (!value) return undefined;
  return Number(value.port || fallback);
}

const projectName = required('COMPOSE_PROJECT_NAME');
if (projectName && !/^chalk-[a-z0-9][a-z0-9-]*$/.test(projectName)) {
  errors.push('COMPOSE_PROJECT_NAME must match chalk-<lowercase-worktree-id>');
}

const postgresPort = port('POSTGRES_HOST_PORT');
const minioPort = port('MINIO_HOST_PORT');
const minioConsolePort = port('MINIO_CONSOLE_HOST_PORT');
const webPort = port('WEB_PORT');
const apiPort = port('API_PORT');
const ports = [postgresPort, minioPort, minioConsolePort, webPort, apiPort];
if (ports.every(Number.isInteger) && new Set(ports).size !== ports.length) {
  errors.push('Postgres, MinIO, Web, and API host ports must be distinct');
}

const databaseUrl = url('DATABASE_URL');
const webOrigins = urls('WEB_ORIGIN');
const publicApiUrl = url('NEXT_PUBLIC_API_URL');
required('SESSIONS_ROOT');

if (databaseUrl && !['postgres:', 'postgresql:'].includes(databaseUrl.protocol)) {
  errors.push('DATABASE_URL must use postgresql://');
}
if (databaseUrl && effectivePort(databaseUrl, 5432) !== postgresPort) {
  errors.push('DATABASE_URL port must match POSTGRES_HOST_PORT');
}
if (webOrigins && webOrigins.some((origin) => effectivePort(origin, origin.protocol === 'https:' ? 443 : 80) !== webPort)) {
  errors.push('WEB_ORIGIN port must match WEB_PORT');
}
if (publicApiUrl && effectivePort(publicApiUrl, publicApiUrl.protocol === 'https:' ? 443 : 80) !== apiPort) {
  errors.push('NEXT_PUBLIC_API_URL port must match API_PORT');
}

if (process.env.NODE_ENV === 'production') {
  errors.push('env:check is for local development and refuses NODE_ENV=production');
}

if (errors.length > 0) {
  console.error('Invalid worktree environment:');
  for (const error of errors) console.error(`- ${error}`);
  console.error('See docs/runbooks/worktree-development.md.');
  process.exit(1);
}

console.log(`Worktree environment is consistent for ${projectName}.`);
