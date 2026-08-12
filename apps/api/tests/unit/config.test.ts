import { describe, expect, it } from 'vitest';

import { loadConfig } from '../../src/config';

describe('loadConfig', () => {
  it('normalizes multiple web origins and parses cookie settings', () => {
    const config = loadConfig({
      NODE_ENV: 'test',
      API_HOST: '127.0.0.1',
      API_PORT: '3011',
      WEB_ORIGIN: 'http://localhost:3000/, http://127.0.0.1:3000',
      SESSION_COOKIE_NAME: 'chalk_test',
      SESSION_COOKIE_SECURE: 'false',
      SESSION_TTL_DAYS: '14',
    });

    expect(config.webOrigins).toEqual(['http://localhost:3000', 'http://127.0.0.1:3000']);
    expect(config.port).toBe(3011);
    expect(config.sessionCookie).toMatchObject({ name: 'chalk_test', secure: false, ttlDays: 14 });
  });

  it('fails closed when production cookies are not secure', () => {
    expect(() => loadConfig({ NODE_ENV: 'production', SESSION_COOKIE_SECURE: 'false' })).toThrow(
      'SESSION_COOKIE_SECURE must be true in production',
    );
  });
});
