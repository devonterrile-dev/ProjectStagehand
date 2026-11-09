import { describe, expect, it } from 'vitest';

import { buildApp } from '../app';

describe('security headers', () => {
  it('are set on every response', async () => {
    const app = buildApp();
    for (const url of ['/health', '/does-not-exist']) {
      const response = await app.inject({ url });

      expect(response.headers['x-content-type-options'], url).toBe('nosniff');
      expect(response.headers['referrer-policy'], url).toBe('strict-origin-when-cross-origin');
      expect(response.headers['content-security-policy'], url).toBe("frame-ancestors 'self'");
    }
    await app.close();
  });

  it('include HSTS only when the public URL is https', async () => {
    const https = buildApp({ publicUrl: 'https://projectstagehand.com' });
    const http = buildApp({ publicUrl: 'http://localhost:8080' });
    const none = buildApp();

    expect((await https.inject({ url: '/health' })).headers['strict-transport-security']).toBe(
      'max-age=31536000',
    );
    expect((await http.inject({ url: '/health' })).headers['strict-transport-security']).toBe(
      undefined,
    );
    expect((await none.inject({ url: '/health' })).headers['strict-transport-security']).toBe(
      undefined,
    );

    await Promise.all([https.close(), http.close(), none.close()]);
  });
});

describe('trustProxy', () => {
  const forwarded = {
    'x-forwarded-for': '203.0.113.7',
    'x-forwarded-proto': 'https',
  };

  it('uses the forwarded client IP and protocol when enabled', async () => {
    const app = buildApp({ trustProxy: true });
    app.get('/whoami', (request) => ({ ip: request.ip, protocol: request.protocol }));

    const response = await app.inject({ url: '/whoami', headers: forwarded });

    expect(response.json()).toEqual({ ip: '203.0.113.7', protocol: 'https' });
    await app.close();
  });

  it('cannot be spoofed: a visitor-supplied X-Forwarded-For is ignored', async () => {
    // What cloudflared sends when the visitor adds their own X-Forwarded-For: it appends the
    // real address, so only the last entry (one hop back) is trustworthy.
    const app = buildApp({ trustProxy: true });
    app.get('/whoami', (request) => ({ ip: request.ip }));

    for (const spoofed of ['6.6.6.6', '10.0.0.1', '127.0.0.1']) {
      const response = await app.inject({
        url: '/whoami',
        headers: { 'x-forwarded-for': `${spoofed}, 203.0.113.7` },
      });

      expect(response.json(), spoofed).toEqual({ ip: '203.0.113.7' });
    }
    await app.close();
  });

  it('ignores forwarded headers by default', async () => {
    const app = buildApp();
    app.get('/whoami', (request) => ({ ip: request.ip, protocol: request.protocol }));

    const response = await app.inject({ url: '/whoami', headers: forwarded });

    expect(response.json()).toEqual({ ip: '127.0.0.1', protocol: 'http' });
    await app.close();
  });
});
