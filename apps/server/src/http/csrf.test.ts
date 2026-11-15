import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { registerCsrfProtection } from './csrf';

const PUBLIC_URL = 'http://localhost:5173';

describe('CSRF protection', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify();
    registerCsrfProtection(app, { publicUrl: PUBLIC_URL, exempt: ['/api/auth/'] });
    app.get('/api/thing', () => ({ ok: true }));
    app.patch('/api/thing', () => ({ ok: true }));
    app.post('/api/auth/sign-out', () => ({ ok: true }));
    app.post('/not-api', () => ({ ok: true }));
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('allows a same-origin unsafe request', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/thing',
      headers: { origin: PUBLIC_URL },
    });

    expect(response.statusCode).toBe(200);
  });

  it('blocks an unsafe request from another origin', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/thing',
      headers: { origin: 'https://evil.example' },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: 'Forbidden' });
  });

  it('counts the other addresses its own pages are served from as its own', async () => {
    const framed = Fastify();
    registerCsrfProtection(framed, {
      publicUrl: PUBLIC_URL,
      alsoOurs: ['https://123.discordsays.com'],
    });
    framed.patch('/api/thing', () => ({ ok: true }));
    const from = (origin: string) =>
      framed.inject({ method: 'PATCH', url: '/api/thing', headers: { origin } });

    expect((await from('https://123.discordsays.com')).statusCode).toBe(200);
    expect((await from(PUBLIC_URL)).statusCode).toBe(200);
    // Another Discord application's Activity is another site's page.
    expect((await from('https://456.discordsays.com')).statusCode).toBe(403);
    expect((await from('https://discordsays.com')).statusCode).toBe(403);
    await framed.close();

    // Without the setting, Discord's proxy is any other site.
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/thing',
      headers: { origin: 'https://123.discordsays.com' },
    });
    expect(response.statusCode).toBe(403);
  });

  it('blocks an unsafe request with no origin information', async () => {
    const response = await app.inject({ method: 'PATCH', url: '/api/thing' });

    expect(response.statusCode).toBe(403);
  });

  it('falls back to Sec-Fetch-Site when Origin is absent', async () => {
    const same = await app.inject({
      method: 'PATCH',
      url: '/api/thing',
      headers: { 'sec-fetch-site': 'same-origin' },
    });
    const cross = await app.inject({
      method: 'PATCH',
      url: '/api/thing',
      headers: { 'sec-fetch-site': 'cross-site' },
    });

    expect(same.statusCode).toBe(200);
    expect(cross.statusCode).toBe(403);
  });

  it('never blocks safe methods', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/thing',
      headers: { origin: 'https://evil.example' },
    });

    expect(response.statusCode).toBe(200);
  });

  it('leaves exempt and non-API paths alone', async () => {
    const auth = await app.inject({ method: 'POST', url: '/api/auth/sign-out' });
    const other = await app.inject({ method: 'POST', url: '/not-api' });

    expect(auth.statusCode).toBe(200);
    expect(other.statusCode).toBe(200);
  });
});
