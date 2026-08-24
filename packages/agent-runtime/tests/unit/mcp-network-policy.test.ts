import { describe, expect, it } from 'vitest';

import {
  assertSafeMcpHttpUrl,
  isPrivateNetworkAddress,
} from '../../src/mcp/mcp-network-policy';

describe('MCP network policy', () => {
  it('rejects local, private, link-local, and mapped private addresses', () => {
    for (const hostname of [
      'localhost',
      '127.0.0.1',
      '10.0.0.5',
      '169.254.169.254',
      '192.168.1.10',
      '::1',
      'fc00::1',
      '::ffff:127.0.0.1',
    ]) {
      expect(isPrivateNetworkAddress(hostname)).toBe(true);
    }
  });

  it('keeps public literals and unresolved names out of the private-address set', () => {
    expect(isPrivateNetworkAddress('8.8.8.8')).toBe(false);
    expect(isPrivateNetworkAddress('2001:4860:4860::8888')).toBe(false);
    expect(isPrivateNetworkAddress('mcp.example.com')).toBe(false);
  });

  it('rejects private MCP URLs before a request is made', async () => {
    await expect(assertSafeMcpHttpUrl(new URL('http://127.0.0.1:8080/mcp')))
      .rejects.toThrow('private or local network address');
  });
});
