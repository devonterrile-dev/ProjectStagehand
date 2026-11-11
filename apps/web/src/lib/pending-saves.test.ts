import { describe, expect, it } from 'vitest';

import { registerPendingSave, settlePendingSaves } from './pending-saves';

describe('pending saves', () => {
  it('is true with nothing registered', async () => {
    expect(await settlePendingSaves()).toBe(true);
  });

  it('waits for every registered save, and is false when one failed', async () => {
    const settled: string[] = [];
    const ok = registerPendingSave(async () => {
      await Promise.resolve();
      settled.push('ok');
      return true;
    });
    const failing = registerPendingSave(() => {
      settled.push('failing');
      return Promise.resolve(false);
    });

    expect(await settlePendingSaves()).toBe(false);
    expect(settled.sort()).toEqual(['failing', 'ok']);

    failing();
    expect(await settlePendingSaves()).toBe(true);
    ok();
  });
});
