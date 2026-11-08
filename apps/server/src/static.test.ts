import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from './app';

const INDEX_HTML = '<!doctype html><html><body><div id="root"></div></body></html>';
const HTML = { accept: 'text/html,application/xhtml+xml' };

describe('SPA serving', () => {
  let distDir: string;
  let app: FastifyInstance;

  beforeAll(() => {
    distDir = mkdtempSync(join(tmpdir(), 'stagehand-web-'));
    mkdirSync(join(distDir, 'assets'));
    writeFileSync(join(distDir, 'index.html'), INDEX_HTML);
    writeFileSync(join(distDir, 'assets', 'app-abc123.js'), 'console.log("hi");');
    app = buildApp({ webDistDir: distDir });
  });

  afterAll(async () => {
    await app.close();
    rmSync(distDir, { recursive: true, force: true });
  });

  it('serves index.html at the root, uncached', async () => {
    const response = await app.inject({ url: '/', headers: HTML });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toMatch(/text\/html/);
    expect(response.headers['cache-control']).toBe('no-cache');
    expect(response.body).toBe(INDEX_HTML);
  });

  it('falls back to index.html for client-side routes', async () => {
    const response = await app.inject({ url: '/campaigns/123/records?tab=npc', headers: HTML });

    expect(response.statusCode).toBe(200);
    expect(response.body).toBe(INDEX_HTML);
    expect(response.headers['cache-control']).toBe('no-cache');
  });

  it('serves fingerprinted assets with a long-lived cache header', async () => {
    const response = await app.inject({ url: '/assets/app-abc123.js' });

    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(response.body).toBe('console.log("hi");');
  });

  it('returns a JSON 404 for unknown API routes, even for HTML requests', async () => {
    const response = await app.inject({ url: '/api/nope', headers: HTML });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: 'Not Found' });
  });

  it('returns a 404 for missing assets instead of the SPA', async () => {
    const response = await app.inject({ url: '/assets/missing.js', headers: { accept: '*/*' } });

    expect(response.statusCode).toBe(404);
  });

  it('keeps /health as JSON', async () => {
    const response = await app.inject({ url: '/health', headers: HTML });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });
});

describe('without a web build', () => {
  it('does not serve the SPA', async () => {
    const app = buildApp();
    const response = await app.inject({ url: '/', headers: HTML });

    expect(response.statusCode).toBe(404);
    await app.close();
  });
});
