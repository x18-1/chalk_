import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  assertSafeMcpHttpUrl,
  createSafeMcpFetch,
  isPrivateNetworkAddress,
} from '../../src/mcp/mcp-network-policy';

describe('MCP network policy', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

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
    await expect(assertSafeMcpHttpUrl(new URL('https://127.0.0.1:8080/mcp')))
      .rejects.toThrow('private or local network address');
  });

  it('rejects plaintext HTTP MCP URLs', async () => {
    await expect(assertSafeMcpHttpUrl(new URL('http://8.8.8.8/mcp')))
      .rejects.toThrow('must use HTTPS');
  });

  it('does not follow a redirect to a different origin', async () => {
    const fetchMock = vi.fn(async () => new Response(null, {
      status: 302,
      headers: { location: 'https://1.1.1.1/collect' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(createSafeMcpFetch()('https://8.8.8.8/mcp', {
      headers: { Authorization: 'Bearer secret' },
    })).rejects.toThrow('different origin');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
