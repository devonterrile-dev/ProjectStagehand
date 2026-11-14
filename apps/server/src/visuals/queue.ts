/**
 * The background job queue for image generation (F2.3, governance §6: pg-boss, a queue stored
 * in Postgres, no Redis). It runs inside the app process (D-42): the request answers at once
 * with a `generating` asset, a worker makes the image, and the browser polls.
 *
 * pg-boss keeps its own tables in the `pgboss` schema of the same database, created and
 * upgraded by `start()`; our Drizzle migrations never touch it. A job queued when the stack
 * stops is still there at the next start. Retries are ours, not pg-boss's: a failed image is
 * shown to the GM, who decides whether to pay for another.
 *
 * A second queue, `process-visual` (F2.4, D-43), remakes the stage's version of images stored
 * before post-processing existed or by an older version of it. It costs nothing, so one worker
 * is plenty; the startup backfill fills it.
 */
import { PgBoss } from 'pg-boss';

export interface VisualQueue {
  /** Queues the image for an asset already stored as `generating`. */
  enqueue(assetId: string): Promise<void>;
  /** Queues post-processing again for an asset that already has its original. */
  enqueueProcessing(assetId: string): Promise<void>;
  /** Stops taking jobs and waits (briefly) for running ones. */
  stop(): Promise<void>;
}

export const VISUAL_QUEUE = 'generate-visual';
export const PROCESS_QUEUE = 'process-visual';

/** Images being made at once by this server. */
export const VISUAL_WORKERS = 2;

/** An image call can take a few minutes (the provider's own timeout is 5). */
const EXPIRE_SECONDS = 10 * 60;

interface JobData {
  assetId: string;
}

/** A pg-boss queue whose workers run `process` for each asset id. Call `start()` before use. */
export function createPgBossQueue(options: {
  databaseUrl: string;
  process: (assetId: string, signal: AbortSignal) => Promise<void>;
  /** The backfill: post-process an asset's stored original again. */
  reprocess: (assetId: string) => Promise<void>;
  onError: (error: unknown) => void;
}): VisualQueue & { start(): Promise<void> } {
  // A small pool of its own: the app's pool stays for requests.
  const boss = new PgBoss({ connectionString: options.databaseUrl, max: 3 });
  // Without a listener, an 'error' event would crash the process.
  boss.on('error', options.onError);
  const stopping = new AbortController();

  return {
    async start() {
      await boss.start();
      await boss.createQueue(VISUAL_QUEUE, {
        retryLimit: 0,
        expireInSeconds: EXPIRE_SECONDS,
        // Finished jobs are only bookkeeping; the asset row is the record.
        deleteAfterSeconds: 24 * 60 * 60,
      });
      await boss.work<JobData>(
        VISUAL_QUEUE,
        { localConcurrency: VISUAL_WORKERS, batchSize: 1, pollingIntervalSeconds: 2 },
        async (jobs) => {
          for (const job of jobs) await options.process(job.data.assetId, stopping.signal);
        },
      );
      await boss.createQueue(PROCESS_QUEUE, {
        retryLimit: 0,
        expireInSeconds: 5 * 60,
        deleteAfterSeconds: 24 * 60 * 60,
      });
      await boss.work<JobData>(
        PROCESS_QUEUE,
        { localConcurrency: 1, batchSize: 1, pollingIntervalSeconds: 2 },
        async (jobs) => {
          for (const job of jobs) await options.reprocess(job.data.assetId);
        },
      );
    },
    async enqueue(assetId) {
      await boss.send(VISUAL_QUEUE, { assetId } satisfies JobData);
    },
    async enqueueProcessing(assetId) {
      await boss.send(PROCESS_QUEUE, { assetId } satisfies JobData);
    },
    async stop() {
      // Cancel image calls in flight, so they record themselves as interrupted.
      stopping.abort();
      await boss.stop({ graceful: true, timeout: 10_000 });
    },
  };
}

/**
 * Runs each job straight away in this process, without pg-boss. For tests, which wait on
 * `settled()` before checking the result.
 */
export function createInlineQueue(
  process: (assetId: string, signal: AbortSignal) => Promise<void>,
  reprocess: (assetId: string) => Promise<void> = () => Promise.resolve(),
): VisualQueue & { settled(): Promise<void> } {
  const running = new Set<Promise<void>>();
  const stopping = new AbortController();
  const track = (work: Promise<void>) => {
    const job = work.finally(() => running.delete(job));
    running.add(job);
    return Promise.resolve();
  };
  return {
    enqueue(assetId) {
      return track(process(assetId, stopping.signal));
    },
    enqueueProcessing(assetId) {
      return track(reprocess(assetId));
    },
    async stop() {
      stopping.abort();
      await Promise.allSettled([...running]);
    },
    async settled() {
      while (running.size > 0) await Promise.allSettled([...running]);
    },
  };
}
