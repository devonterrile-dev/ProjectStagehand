import { act, fireEvent, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ActivitySdk, SpeakingKind } from '@/activity/discord';
import { TableVoiceContext, type TableVoice } from '@/activity/voice';

import { useVoice } from './voice';

function render(table: TableVoice | null) {
  const said: boolean[] = [];
  const wrapper = ({ children }: { children: ReactNode }) =>
    table === null ? children : <TableVoiceContext value={table}>{children}</TableVoiceContext>;
  const hook = renderHook(() => useVoice((speaking) => said.push(speaking)), { wrapper });
  return { said, hook };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useVoice (F3.9)', () => {
  it('uses the mic in a tab, with T beside it', () => {
    // jsdom has no mic: the table says so and still listens for T.
    const { said, hook } = render(null);
    const voice = hook.result.current;

    expect(voice.from).toBe('mic');
    if (voice.from === 'mic') expect(voice.mic.store.getState().status).toBe('unavailable');
    fireEvent.keyDown(window, { key: 't' });
    fireEvent.keyUp(window, { key: 't' });
    expect(said).toEqual([true, false]);
  });

  it('hears the player’s own Discord voice in the Activity, and says if Discord won’t', async () => {
    let send: ((kind: SpeakingKind, userId: string) => void) | null = null;
    let fail: ((error: Error) => void) | null = null;
    const sdk = {
      subscribeSpeaking: (listener: (kind: SpeakingKind, userId: string) => void) => {
        send = listener;
        return new Promise((_, reject) => {
          fail = reject;
        });
      },
    } as unknown as ActivitySdk;
    const { said, hook } = render({ from: 'discord', voice: { sdk, discordUserId: 'me' } });

    expect(hook.result.current).toEqual({ from: 'discord', failed: false });
    act(() => {
      send?.('start', 'me');
      send?.('stop', 'me');
    });
    expect(said).toEqual([true, false]);

    await act(async () => {
      fail?.(new Error('Not authenticated'));
      await Promise.resolve();
    });
    expect(hook.result.current).toEqual({ from: 'discord', failed: true });
  });

  it('listens only for T in the Activity without the voice scope', () => {
    const { said, hook } = render({ from: 'key' });
    expect(hook.result.current).toEqual({ from: 'key' });
    fireEvent.keyDown(window, { key: 't' });
    expect(said).toEqual([true]);
  });
});
