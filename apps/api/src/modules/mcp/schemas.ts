import { z } from 'zod';

import { isPrivateNetworkAddress } from '@chalk/agent-runtime';
import { envSchema, httpUrlSchema } from '../../http/validation';

export const mcpServerParamsSchema = z.object({ id: z.string().uuid() });

const mcpHttpUrlSchema = httpUrlSchema.superRefine((value, context) => {
  const url = new URL(value);
  if (url.protocol !== 'https:') {
    context.addIssue({ code: 'custom', message: 'MCP URL must use HTTPS' });
  }
  if (url.username || url.password) {
    context.addIssue({ code: 'custom', message: 'MCP URL must not contain credentials' });
  }
  if (isPrivateNetworkAddress(url.hostname)) {
    context.addIssue({ code: 'custom', message: 'MCP URL must not target a private or local network address' });
  }
});

export const mcpServerSchema = z.object({
  name: z.string().trim().min(1).max(100),
  transport: z.enum(['stdio', 'sse', 'http']),
  command: z.string().trim().min(1).max(500).optional(),
  args: z.array(z.string().max(500)).max(100).optional(),
  url: mcpHttpUrlSchema.optional(),
  env: envSchema.optional(),
  bearerToken: z.string().trim().min(1).max(4096).optional(),
  enabled: z.boolean().default(true),
}).strict().superRefine((value, context) => {
  if (value.transport === 'stdio' && !value.command) {
    context.addIssue({
      code: 'custom',
      path: ['command'],
      message: 'stdio MCP requires command',
    });
  }
  if (value.transport !== 'stdio' && !value.url) {
    context.addIssue({
      code: 'custom',
      path: ['url'],
      message: 'HTTP MCP requires url',
    });
  }
});

export const mcpServerUpdateSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  transport: z.enum(['stdio', 'sse', 'http']).optional(),
  command: z.string().trim().min(1).max(500).nullable().optional(),
  args: z.array(z.string().max(500)).max(100).optional(),
  url: mcpHttpUrlSchema.nullable().optional(),
  env: envSchema.nullable().optional(),
  bearerToken: z.string().trim().min(1).max(4096).nullable().optional(),
  enabled: z.boolean().optional(),
}).strict();

export type McpServerInput = z.infer<typeof mcpServerSchema>;
export type McpServerUpdateInput = z.infer<typeof mcpServerUpdateSchema>;
