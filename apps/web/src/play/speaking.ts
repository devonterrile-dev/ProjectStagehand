/**
 * Speaking detection (governance §13, F3.7, D-55): where a browser learns that its person is
 * talking. Only a true or false ever leaves the browser, never any sound.
 *
 * Every source has the same shape, so the live room doesn't care which one is in use. The first
 * was a key held down to talk (F3.7); the browser mic (`mic.ts`) and the Discord Activity's
 * speaking events (`@/activity/voice`) came with F3.9, and the key stays beside them.
 */
import { useEffect } from 'react';

export interface SpeakingSource {
  /** Starts listening; `onChange` is called whenever talking starts or stops. Returns the stop. */
  start(onChange: (speaking: boolean) => void): () => void;
}

/** The key held down to talk. */
export const TALK_KEY = 't';

/** Whether a key press belongs to something being typed in, not to the table. */
function typing(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest('input, select, textarea, [contenteditable]:not([contenteditable="false"])') !==
      null
  );
}

/**
 * Talking while a key is held (F3.7): **T** by default. Not while typing (a sticky note, a
 * field on the desk), not with Ctrl, Alt or Meta, and it stops if the window loses focus while
 * the key is down, since the release would never arrive.
 */
export function holdKeySource(key: string = TALK_KEY, target: Window = window): SpeakingSource {
  return {
    start(onChange) {
      let down = false;
      const set = (speaking: boolean) => {
        if (speaking === down) return;
        down = speaking;
        onChange(speaking);
      };
      const onDown = (event: KeyboardEvent) => {
        if (event.key.toLowerCase() !== key || event.defaultPrevented) return;
        if (event.ctrlKey || event.altKey || event.metaKey || typing(event.target)) return;
        set(true);
      };
      const onUp = (event: KeyboardEvent) => {
        if (event.key.toLowerCase() === key) set(false);
      };
      const onBlur = () => {
        set(false);
      };
      target.addEventListener('keydown', onDown);
      target.addEventListener('keyup', onUp);
      target.addEventListener('blur', onBlur);
      return () => {
        target.removeEventListener('keydown', onDown);
        target.removeEventListener('keyup', onUp);
        target.removeEventListener('blur', onBlur);
        set(false);
      };
    },
  };
}

/** Talking while any of the sources says so (F3.9): the mic or Discord, and the key. */
export function anySource(sources: readonly SpeakingSource[]): SpeakingSource {
  return {
    start(onChange) {
      const talking = new Set<number>();
      let said = false;
      const update = () => {
        const now = talking.size > 0;
        if (now === said) return;
        said = now;
        onChange(now);
      };
      const stops = sources.map((source, index) =>
        source.start((speaking) => {
          if (speaking) talking.add(index);
          else talking.delete(index);
          update();
        }),
      );
      return () => {
        for (const stop of stops) stop();
        talking.clear();
        update();
      };
    },
  };
}

/** Feeds a speaking source into `setSpeaking` while mounted; stops talking when it goes. */
export function useSpeaking(
  setSpeaking: (speaking: boolean) => void,
  source: SpeakingSource | null,
): void {
  useEffect(() => {
    if (source === null) return;
    return source.start(setSpeaking);
  }, [setSpeaking, source]);
}
