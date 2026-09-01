import { z } from 'zod';

const toolApprovalTimeoutSchema = z.coerce
  .number()
  .int()
  .min(1_000)
  .max(24 * 60 * 60 * 1_000)
  .default(120_000);

const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_HOST: z.string().min(1).default('127.0.0.1'),
  API_PORT: z.coerce.number().int().min(1).max(65_535).default(3001),
  WEB_ORIGIN: z.string().default('http://localhost:3000'),
  SESSION_COOKIE_NAME: z.string().min(1).default('chalk_session'),
  SESSION_COOKIE_SECURE: z.enum(['true', 'false']).default('false'),
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  TOOL_APPROVAL_TIMEOUT_MS: toolApprovalTimeoutSchema,
  RAG_SIDECAR_URL: z.string().url().default('http://127.0.0.1:8010'),
  RAG_SIDECAR_TOKEN: z.string().trim().min(1).optional(),
  RAG_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120000).default(30000),
});

export type ApiConfig = {
  nodeEnv: 'development' | 'test' | 'production';
  host: string;
  port: number;
  webOrigins: readonly string[];
  sessionCookie: {
    name: string;
    secure: boolean;
    ttlDays: number;
  };
  toolApprovalTimeoutMs: number;
  ragSidecarUrl: string;
  ragSidecarToken: string;
  ragTimeoutMs: number;
};

export function parseToolApprovalTimeoutMs(
  value: string | number | undefined = process.env.TOOL_APPROVAL_TIMEOUT_MS,
) {
  return toolApprovalTimeoutSchema.parse(value);
}

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): ApiConfig {
  const parsed = environmentSchema.parse(environment);
  const webOrigins = parsed.WEB_ORIGIN
    .split(',')
    .map((origin) => origin.trim().replace(/\/$/, ''))
    .filter(Boolean);

  if (parsed.NODE_ENV === 'production' && parsed.SESSION_COOKIE_SECURE !== 'true') {
    throw new Error('SESSION_COOKIE_SECURE must be true in production');
  }
  if (parsed.NODE_ENV !== 'test' && !parsed.RAG_SIDECAR_TOKEN) {
    throw new Error('RAG_SIDECAR_TOKEN must be configured outside test environments');
  }

  return {
    nodeEnv: parsed.NODE_ENV,
    host: parsed.API_HOST,
    port: parsed.API_PORT,
    webOrigins,
    sessionCookie: {
      name: parsed.SESSION_COOKIE_NAME,
      secure: parsed.SESSION_COOKIE_SECURE === 'true',
      ttlDays: parsed.SESSION_TTL_DAYS,
    },
    toolApprovalTimeoutMs: parsed.TOOL_APPROVAL_TIMEOUT_MS,
    ragSidecarUrl: parsed.RAG_SIDECAR_URL,
    // Tests inject a fake sidecar client and do not make authenticated calls.
    ragSidecarToken: parsed.RAG_SIDECAR_TOKEN ?? '',
    ragTimeoutMs: parsed.RAG_TIMEOUT_MS,
  };
}
