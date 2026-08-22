import { z } from 'zod';

import { envSchema, httpUrlSchema } from '../../http/validation';

export const mcpServerParamsSchema = z.object({ id: z.string().uuid() });

export const mcpServerSchema = z.object({
  name: z.string().trim().min(1).max(100),
  transport: z.enum(['stdio', 'sse', 'http']),
  command: z.string().trim().min(1).max(500).optional(),
  args: z.array(z.string().max(500)).max(100).optional(),
  url: httpUrlSchema.optional(),
  env: envSchema.optional(),
  enabled: z.boolean().default(true),
}).superRefine((value, context) => {
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
  url: httpUrlSchema.nullable().optional(),
  env: envSchema.nullable().optional(),
  enabled: z.boolean().optional(),
});

export type McpServerInput = z.infer<typeof mcpServerSchema>;
export type McpServerUpdateInput = z.infer<typeof mcpServerUpdateSchema>;
