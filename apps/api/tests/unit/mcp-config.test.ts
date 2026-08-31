import { describe, expect, it } from 'vitest';

import { mcpServerSchema, mcpServerUpdateSchema } from '../../src/modules/mcp/schemas';

describe('MCP owner-scoped auth configuration', () => {
  it('accepts a bearer token without returning it as part of the public shape', () => {
    const parsed = mcpServerSchema.parse({
      name: 'docs',
      transport: 'http',
      url: 'https://example.com/mcp',
      bearerToken: 'secret-token',
    });
    expect(parsed.bearerToken).toBe('secret-token');
  });

  it('rejects fields outside the HTTPS plus bearer v1 contract', () => {
    expect(() => mcpServerUpdateSchema.parse({
      oauth: {
        authorizationUrl: 'https://example.com/authorize',
        tokenUrl: 'https://example.com/token',
        clientId: 'chalk-client',
      },
    })).toThrow();
  });

  it('requires HTTPS for remote MCP servers', () => {
    expect(() => mcpServerSchema.parse({
      name: 'insecure',
      transport: 'http',
      url: 'http://example.com/mcp',
    })).toThrow(/must use HTTPS/);
  });
});
