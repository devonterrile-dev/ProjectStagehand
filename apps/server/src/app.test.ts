import { healthResponseSchema } from '@stagehand/shared';
import { afterAll, describe, expect, it } from 'vitest';

import { buildApp } from './app';

describe('GET /health', () => {
  const app = buildApp();

  afterAll(async () => {
    await app.close();
  });

  it('returns 200 with a schema-valid body', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(healthResponseSchema.parse(response.json())).toEqual({ status: 'ok' });
  });
});
