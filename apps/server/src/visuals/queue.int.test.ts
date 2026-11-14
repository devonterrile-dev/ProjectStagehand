/**
 * The pg-boss image queue (F2.3, D-42) against the real test database: it installs itself,
 * hands each queued asset id to the worker once, and stops cleanly. The route tests use the
 * inline queue instead, so this is the only test that runs pg-boss.
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { createPgBossQueue } from './queue';

describe('pg-boss visual queue', () => {
  const seen: string[] = [];
  let signalOf: AbortSignal | null = null;
  const queue = createPgBossQueue({
    databaseUrl: inject('databaseUrl'),
    process: (assetId, signal) => {
      seen.push(assetId);
      signalOf = signal;
      return Promise.resolve();
    },
    onError: (error) => {
      throw error;
    },
  });

  beforeAll(async () => {
    await queue.start();
  }, 30_000);

  afterAll(async () => {
    await queue.stop();
  });

  async function until(check: () => boolean, ms = 15_000): Promise<void> {
    const end = Date.now() + ms;
    while (!check()) {
      if (Date.now() > end) throw new Error('timed out waiting for the queue');
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  it('runs each queued asset once', async () => {
    const ids: string[] = [randomUUID(), randomUUID()];
    for (const id of ids) await queue.enqueue(id);

    await until(() => ids.every((id) => seen.includes(id)));
    expect(seen.filter((id) => ids.includes(id)).sort()).toEqual([...ids].sort());
    expect(signalOf?.aborted).toBe(false);
  });

  it('starts again on an existing install', async () => {
    const again = createPgBossQueue({
      databaseUrl: inject('databaseUrl'),
      process: () => Promise.resolve(),
      onError: () => undefined,
    });
    await again.start();
    await again.stop();
  }, 30_000);
});
