/**
 * Per-field autosave for a record, sheet or stat block (D-22, D-23). Edits are merged into one pending patch and sent
 * after a short pause, on blur, on unmount and when the page unloads. Requests for the
 * record go out one at a time, in order, so the server's "last write wins" matches what
 * the GM typed last. A failed patch is kept and merged under anything typed since, so a
 * retry (or the next edit) sends everything.
 */
import type { UpdateRecordRequest } from '@stagehand/shared';
import { useCallback, useEffect, useRef, useState } from 'react';

export type AutosaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export type SendPatch<P extends object = UpdateRecordRequest> = (
  patch: P,
  options: { keepalive: boolean },
) => Promise<unknown>;

export interface Autosave<P extends object = UpdateRecordRequest> {
  status: AutosaveStatus;
  /** The last failure's message, while `status` is `error`. */
  error: string | null;
  /** Merges the patch into what's pending and restarts the pause. */
  save: (patch: P) => void;
  /** Sends whatever is pending now (blur, Retry). */
  flush: () => void;
  /** Drops pending edits without sending them (before a delete). */
  discard: () => void;
  /** True while an edit is waiting to be sent. */
  isDirty: () => boolean;
  /**
   * Sends what's pending and waits for every request to finish. True when everything is
   * saved, false when a save failed (its edits are kept for Retry). Used before leaving.
   */
  settle: () => Promise<boolean>;
}

/**
 * For records: `next` over `base`, where top-level keys replace and `fields` and `links`
 * merge key by key (each link field is a whole list). Null values survive the merge, so
 * clearing a field and setting it again each win in the order they happened.
 */
export function mergeRecordPatch(
  base: UpdateRecordRequest,
  next: UpdateRecordRequest,
): UpdateRecordRequest {
  const merged: UpdateRecordRequest = { ...base, ...next };
  if (base.fields !== undefined || next.fields !== undefined) {
    merged.fields = { ...base.fields, ...next.fields };
  }
  if (base.links !== undefined || next.links !== undefined) {
    merged.links = { ...base.links, ...next.links };
  }
  return merged;
}

/** `next` over `base`, key by key: for patches where every key replaces its whole value. */
export function mergeShallow<P extends object>(base: P, next: P): P {
  return { ...base, ...next };
}

export interface AutosaveOptions<P extends object> {
  /** Pause before a save goes out, in milliseconds. */
  delay?: number;
  /** How a new edit joins what's pending. Defaults to `mergeShallow`. */
  merge?: (base: P, next: P) => P;
}

export function useAutosave<P extends object = UpdateRecordRequest>(
  send: SendPatch<P>,
  { delay = 800, merge = mergeShallow }: AutosaveOptions<P> = {},
): Autosave<P> {
  const [status, setStatus] = useState<AutosaveStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const sendRef = useRef(send);
  const pending = useRef<P | null>(null);
  const mergeRef = useRef(merge);
  const timer = useRef<number | null>(null);
  /** Requests chain onto this promise, which never rejects. */
  const queue = useRef<Promise<void>>(Promise.resolve());
  const inFlight = useRef(0);
  const mounted = useRef(false);

  useEffect(() => {
    sendRef.current = send;
    mergeRef.current = merge;
  }, [send, merge]);

  const clearTimer = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  const flush = useCallback(
    (options = { keepalive: false }) => {
      clearTimer();
      const patch = pending.current;
      if (patch === null) return;
      pending.current = null;
      inFlight.current += 1;
      if (mounted.current) setStatus('saving');

      queue.current = queue.current.then(async () => {
        try {
          await sendRef.current(patch, options);
          if (mounted.current && inFlight.current === 1 && pending.current === null) {
            setError(null);
            setStatus('saved');
          }
        } catch (sendError) {
          // Keep what failed, under anything typed since, for the retry.
          pending.current =
            pending.current === null ? patch : mergeRef.current(patch, pending.current);
          if (mounted.current) {
            setError(sendError instanceof Error ? sendError.message : 'Something went wrong');
            setStatus('error');
          }
        } finally {
          inFlight.current -= 1;
        }
      });
    },
    [clearTimer],
  );

  const save = useCallback(
    (patch: P) => {
      pending.current = pending.current === null ? patch : mergeRef.current(pending.current, patch);
      clearTimer();
      timer.current = window.setTimeout(() => {
        timer.current = null;
        flush();
      }, delay);
      // An error stays visible until the next attempt goes out.
      setStatus((current) => (current === 'error' ? current : 'saving'));
    },
    [clearTimer, delay, flush],
  );

  const discard = useCallback(() => {
    clearTimer();
    pending.current = null;
  }, [clearTimer]);

  const isDirty = useCallback(() => pending.current !== null, []);

  const settle = useCallback(async () => {
    flush();
    await queue.current;
    // A failure puts its patch back in `pending`.
    return pending.current === null;
  }, [flush]);

  useEffect(() => {
    mounted.current = true;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (pending.current === null && inFlight.current === 0) return;
      // keepalive lets the request outlive the page; bodies over 64 KB would be refused,
      // which is why it's only used here.
      flush({ keepalive: true });
      event.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      mounted.current = false;
      // Leaving the page sends what's pending; the request outlives the component.
      flush();
    };
  }, [flush]);

  return {
    status,
    error,
    save,
    flush: () => {
      flush();
    },
    discard,
    isDirty,
    settle,
  };
}
