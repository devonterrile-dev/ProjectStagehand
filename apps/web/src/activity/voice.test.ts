import { describe, expect, it } from 'vitest';

import type { ActivitySdk, SpeakingKind } from './discord';
import { discordSource } from './voice';

/** A Discord SDK whose speaking events a test sends by hand. */
function fakeSdk(fails = false) {
  let send: ((kind: SpeakingKind, userId: string) => void) | null = null;
  let unsubscribed = 0;
  const sdk = {
    subscribeSpeaking: (listener: (kind: SpeakingKind, userId: string) => void) => {
      if (fails) return Promise.reject(new Error('Not authenticated (code 4006)'));
      send = listener;
      return Promise.resolve(() => {
        unsubscribed += 1;
      });
    },
  } as unknown as ActivitySdk;
  return {
    sdk,
    send: (kind: SpeakingKind, userId: string) => send?.(kind, userId),
    unsubscribed: () => unsubscribed,
  };
}

describe('discordSource (F3.9)', () => {
  it('passes on the player’s own talking, and nobody else’s', async () => {
    const discord = fakeSdk();
    const changes: boolean[] = [];
    const stop = discordSource({ sdk: discord.sdk, discordUserId: 'me' }).start((speaking) =>
      changes.push(speaking),
    );
    await Promise.resolve();

    discord.send('start', 'someone-else');
    discord.send('start', 'me');
    discord.send('start', 'me');
    discord.send('stop', 'someone-else');
    expect(changes).toEqual([true]);
    discord.send('stop', 'me');
    discord.send('start', 'me');

    stop();
    expect(changes).toEqual([true, false, true, false]);
    expect(discord.unsubscribed()).toBe(1);
    discord.send('start', 'me');
    expect(changes).toHaveLength(4);
  });

  it('stops listening when it was stopped before Discord answered', async () => {
    const discord = fakeSdk();
    const stop = discordSource({ sdk: discord.sdk, discordUserId: 'me' }).start(() => undefined);
    stop();
    await Promise.resolve();
    await Promise.resolve();
    expect(discord.unsubscribed()).toBe(1);
  });

  it('says when Discord won’t send speaking events', async () => {
    const discord = fakeSdk(true);
    let failed = false;
    discordSource({ sdk: discord.sdk, discordUserId: 'me' }, () => {
      failed = true;
    }).start(() => undefined);
    await Promise.resolve();
    await Promise.resolve();
    expect(failed).toBe(true);
  });
});
