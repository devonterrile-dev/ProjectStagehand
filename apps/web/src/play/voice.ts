/**
 * Where the table hears its person talk (F3.9, governance §13, D-57): the browser mic in a tab,
 * Discord's speaking events in the Activity, and holding T everywhere, beside either.
 */
import { useContext, useState } from 'react';

import { discordSource, TableVoiceContext } from '@/activity/voice';

import { createMic, type Mic } from './mic';
import { anySource, holdKeySource, useSpeaking, type SpeakingSource } from './speaking';

export type Voice =
  /** A tab: the mic, asked for on joining the table. */
  | { from: 'mic'; mic: Mic }
  /** The Activity with the voice scope; `failed` once Discord won't send speaking events. */
  | { from: 'discord'; failed: boolean }
  /** The Activity without it: holding T only. */
  | { from: 'key' };

/** Feeds the table's speaking sources into `setSpeaking` while mounted. */
export function useVoice(setSpeaking: (speaking: boolean) => void): Voice {
  const table = useContext(TableVoiceContext);
  const [failed, setFailed] = useState(false);
  const [{ mic, source }] = useState(() => {
    const made = table.from === 'mic' ? createMic() : null;
    let heard: SpeakingSource | null = made;
    if (table.from === 'discord') {
      heard = discordSource(table.voice, () => {
        setFailed(true);
      });
    }
    const key = holdKeySource();
    return { mic: made, source: anySource(heard === null ? [key] : [heard, key]) };
  });
  useSpeaking(setSpeaking, source);

  if (mic !== null) return { from: 'mic', mic };
  return table.from === 'discord' ? { from: 'discord', failed } : { from: 'key' };
}
