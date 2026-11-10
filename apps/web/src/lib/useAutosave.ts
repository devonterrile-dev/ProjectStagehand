/**
 * Per-field autosave for a record (D-22). Edits are merged into one pending patch and sent
 * after a short pause, on blur, on unmount and when the page unloads. Requests for the
 * record go out one at a time, in order, so the server's "last write wins" matches what
 * the GM typed last. A failed patch is kept and merged under anything typed since, so a
 * retry (or the next edit) sends everything.
 */
import type { UpdateRecordRequest } from '@stagehand/shared';
import { useCallback, useEffect, useRef, useState } from 'react';

export type AutosaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export type SendPatch = (
  patch: UpdateRecordRequest,
  options: { keepalive: boolean },
) => Promise<unknown>;

export interface Autosave {
  status: AutosaveStatus;
  /** The last failure's message, while `status` is `error`. */
  error: string | null;
  /** Merges the patch into what's pending and restarts the pause. */
  save: (patch: UpdateRecordRequest) => void;
  /** Sends whatever is pending now (blur, Retry). */
  flush: () => void;
  /** Drops pending edits without sending them (before a delete). */
  discard: () => void;
  /** True while an edit is waiting to be sent. */
  isDirty: () => boolean;
}

/**
 * `next` over `base`: top-level keys replace, `fields` merge key by key. Null values survive
 * the merge, so clearing a field and setting it again each win in the order they happened.
 */
export function mergePatch(
  base: UpdateRecordRequest,
  next: UpdateRecordRequest,
): UpdateRecordRequest {
  const merged: UpdateRecordRequest = { ...base, ...next };
  if (base.fields !== undefined || next.fields !== undefined) {
    merged.fields = { ...base.fields, ...next.fields };
  }
  return merged;
}

export function useAutosave(send: SendPatch, delay = 800): Autosave {
  const [status, setStatus] = useState<AutosaveStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const sendRef = useRef(send);
  const pending = useRef<UpdateRecordRequest | null>(null);
  const timer = useRef<number | null>(null);
  /** Requests chain onto this promise, which never rejects. */
  const queue = useRef<Promise<void>>(Promise.resolve());
  const inFlight = useRef(0);
  const mounted = useRef(false);

  useEffect(() => {
    sendRef.current = send;
  }, [send]);

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
          pending.current = mergePatch(patch, pending.current ?? {});
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
    (patch: UpdateRecordRequest) => {
      pending.current = mergePatch(pending.current ?? {}, patch);
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
  };
}
