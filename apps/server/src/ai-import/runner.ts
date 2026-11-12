/**
 * Runs import jobs in the background of the API process (D-27). A model call can take
 * minutes, and Cloudflare Tunnel drops a request that stays silent for 100 seconds, so the
 * route answers at once and the browser polls for the result.
 *
 * There is no queue and nothing survives a restart: an import that was running when the
 * server stopped is marked failed at the next start (`failInterruptedImports`). pg-boss
 * arrives with image generation (F2.3).
 */

export interface ImportRunner {
  /**
   * Starts a job without waiting for it. The job gets a signal that fires when the server
   * shuts down. A job that throws is reported to `onError` and otherwise forgotten.
   */
  run(job: (signal: AbortSignal) => Promise<void>): void;
  /** Cancels the jobs in flight and waits for them to wind down. */
  stop(): Promise<void>;
}

export function createImportRunner(onError: (error: unknown) => void): ImportRunner {
  const controller = new AbortController();
  const inFlight = new Set<Promise<void>>();

  return {
    run(job) {
      const promise = (async () => {
        try {
          await job(controller.signal);
        } catch (error) {
          onError(error);
        }
      })();
      inFlight.add(promise);
      void promise.finally(() => inFlight.delete(promise));
    },
    async stop() {
      controller.abort();
      await Promise.allSettled([...inFlight]);
    },
  };
}
