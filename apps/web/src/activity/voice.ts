/**
 * Hearing who talks inside the Discord Activity (F3.9, governance §13, D-57). Discord's own
 * voice detection says when anyone in the voice channel starts or stops talking; each browser
 * passes on only its own player's, as a tab does with the mic, so nobody needs anyone else's
 * Discord id. Only types come from the SDK's module here: a page in a tab never loads it.
 */
import { createContext } from 'react';

import type { SpeakingSource } from '@/play/speaking';

import type { ActivityVoice } from './enter';

/**
 * Where the table hears talking from, besides holding T:
 * - `mic`: the browser mic (a normal tab, the default).
 * - `discord`: Discord's speaking events (the Activity, with the voice scope granted).
 * - `key`: only the key (the Activity, with the voice scope turned down).
 */
export type TableVoice =
  { from: 'mic' } | { from: 'discord'; voice: ActivityVoice } | { from: 'key' };

export const TableVoiceContext = createContext<TableVoice>({ from: 'mic' });

/**
 * Talking from Discord: this player's own starts and stops, nobody else's. `onFailed` hears
 * when Discord won't send them after all.
 */
export function discordSource(voice: ActivityVoice, onFailed?: () => void): SpeakingSource {
  return {
    start(onChange) {
      let stopped = false;
      let talking = false;
      let unsubscribe: (() => void) | null = null;
      void voice.sdk
        .subscribeSpeaking((kind, userId) => {
          const now = kind === 'start';
          if (stopped || userId !== voice.discordUserId || now === talking) return;
          talking = now;
          onChange(now);
        })
        .then(
          (stop) => {
            if (stopped) stop();
            else unsubscribe = stop;
          },
          () => {
            if (!stopped) onFailed?.();
          },
        );
      return () => {
        stopped = true;
        unsubscribe?.();
        if (talking) {
          talking = false;
          onChange(false);
        }
      };
    },
  };
}
