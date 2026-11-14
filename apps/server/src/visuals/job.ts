/**
 * One Generate visual job (F2.3, §11 steps 3 to 5): claim the queued try, call OpenRouter with
 * the prompt and the kind's two anchors on the GM's own key, store the image as the model sent
 * it, post-process it (F2.4, D-43), and record how it ended. If post-processing fails, the try
 * still ends `pending` with its original: the GM has paid for it.
 *
 * Also the backfill job (`processStoredVisual`): images made before post-processing existed,
 * or by an older version of it, are processed again from their stored original.
 *
 * Never throws: every way it can end is written to the asset. Only an error's kind is
 * reported; the prompt (private campaign text) and the key never reach a log.
 */
import type { AssetKind, VisualErrorCode } from '@stagehand/shared';

import {
  assetsToProcess,
  claimVisual,
  finishVisual,
  saveProcessed,
  unprocessedVisual,
  type ClaimedVisual,
  type ProcessedFile,
  type VisualOutcome,
} from '../campaigns/visuals';
import { CredentialUnreadableError } from '../credentials/crypto';
import { getProviderKey } from '../credentials/store';
import type { Database } from '../db/client';
import type { ImageCallResult, ImageFailure, OpenRouterProvider } from '../providers/openrouter';

import { PROCESSING_VERSION, processImage, type ProcessedImage } from './process';
import type { VisualQueue } from './queue';
import type { ReferencesByKind } from './references';
import { extensionOf, originalKey, processedKey, type AssetStorage } from './storage';

/** Makes the stage's version of an image; `processImage` unless a test swaps it. */
export type ImageProcessor = (input: Buffer, kind: AssetKind) => Promise<ProcessedImage>;

/** Which part of a job an error came from, for the log. */
export type VisualJobStage = 'generate' | 'process';

export interface VisualJobDeps {
  db: Database;
  /** CREDENTIALS_ENCRYPTION_KEY, to decrypt the GM's OpenRouter key. */
  credentialsKey: Buffer;
  openrouter: Pick<OpenRouterProvider, 'generateImage'>;
  storage: AssetStorage;
  references: ReferencesByKind;
  /** How long to wait before the one retry of a rate-limited call. */
  rateLimitPauseMs?: number;
  /** Post-processing; defaults to `processImage`. */
  processImage?: ImageProcessor;
  /** Told the kind of an unexpected error, never its message. */
  onError?: (assetId: string, errorName: string, stage: VisualJobStage) => void;
}

/** What the backfill job needs: no provider, no key. */
export type ProcessJobDeps = Pick<VisualJobDeps, 'db' | 'storage' | 'processImage' | 'onError'>;

function errorNameOf(error: unknown): string {
  return error instanceof Error ? error.name : 'unknown';
}

/**
 * Post-processes an original and stores the result. Null when it can't be made (an image with
 * nothing left once the key color is gone, a file sharp can't read): reported, never thrown.
 */
async function storeProcessed(
  deps: ProcessJobDeps,
  asset: { id: string; campaignId: string; kind: AssetKind },
  original: Buffer,
): Promise<ProcessedFile | null> {
  try {
    const processed = await (deps.processImage ?? processImage)(original, asset.kind);
    const key = processedKey(asset.campaignId, asset.id);
    await deps.storage.put(key, processed.data);
    return {
      key,
      width: processed.width,
      height: processed.height,
      version: PROCESSING_VERSION,
    };
  } catch (error) {
    deps.onError?.(asset.id, errorNameOf(error), 'process');
    return null;
  }
}

const FAILURE_CODES: Record<ImageFailure['status'], VisualErrorCode> = {
  rejected: 'key_rejected',
  forbidden: 'key_forbidden',
  no_credit: 'no_credit',
  rate_limited: 'rate_limited',
  bad_request: 'bad_request',
  failed: 'failed',
  unreachable: 'unreachable',
  aborted: 'interrupted',
};

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

async function makeImage(
  deps: VisualJobDeps,
  claimed: ClaimedVisual,
  signal: AbortSignal | undefined,
): Promise<VisualOutcome> {
  let apiKey: string | null;
  try {
    apiKey = await getProviderKey(deps.db, deps.credentialsKey, claimed.createdBy, 'openrouter');
  } catch (error) {
    if (error instanceof CredentialUnreadableError) return { ok: false, errorCode: 'key_missing' };
    throw error;
  }
  if (apiKey === null) return { ok: false, errorCode: 'key_missing' };

  const request = {
    apiKey,
    model: claimed.model,
    prompt: claimed.prompt,
    references: deps.references[claimed.kind],
    aspectRatio: claimed.aspectRatio,
    quality: claimed.quality,
    ...(signal === undefined ? {} : { signal }),
  };
  const stopped = (): boolean => signal?.aborted === true;
  let call: ImageCallResult = await deps.openrouter.generateImage(request);
  if (call.status === 'rate_limited' && !stopped()) {
    // One more try after a pause: a rate-limited call isn't billed.
    await sleep(deps.rateLimitPauseMs ?? 10_000, signal);
    if (!stopped()) call = await deps.openrouter.generateImage(request);
  }
  if (call.status !== 'ok') return { ok: false, errorCode: FAILURE_CODES[call.status] };

  const key = originalKey(claimed.campaignId, claimed.id, extensionOf(call.mediaType));
  await deps.storage.put(key, call.image);
  const processed = await storeProcessed(deps, claimed, call.image);
  return { ok: true, key, mediaType: call.mediaType, costUsd: call.costUsd, processed };
}

/** Makes the image for one queued asset. A try that isn't waiting any more is left alone. */
export async function processVisualJob(
  deps: VisualJobDeps,
  assetId: string,
  signal?: AbortSignal,
): Promise<void> {
  let claimed: ClaimedVisual | null = null;
  try {
    claimed = await claimVisual(deps.db, assetId);
    if (claimed === null) return;
    await finishVisual(deps.db, assetId, await makeImage(deps, claimed, signal));
  } catch (error) {
    deps.onError?.(assetId, errorNameOf(error), 'generate');
    if (claimed !== null) {
      await finishVisual(deps.db, assetId, { ok: false, errorCode: 'internal' }).catch(() => {
        // The database is gone too; the startup sweep marks it interrupted.
      });
    }
  }
}

/**
 * The backfill job: (re)makes the stage's version of an image from its stored original. An
 * image already at this post-processing version is left alone, so a job queued twice is cheap.
 */
export async function processStoredVisual(deps: ProcessJobDeps, assetId: string): Promise<void> {
  try {
    const asset = await unprocessedVisual(deps.db, assetId, PROCESSING_VERSION);
    if (asset === null) return;
    const original = await deps.storage.read(asset.originalPath);
    if (original === null) {
      deps.onError?.(assetId, 'OriginalMissing', 'process');
      return;
    }
    const processed = await storeProcessed(deps, asset, original);
    if (processed !== null) await saveProcessed(deps.db, assetId, processed);
  } catch (error) {
    deps.onError?.(assetId, errorNameOf(error), 'process');
  }
}

/**
 * At startup: queues every image whose stage version is missing or older than this server's
 * post-processing. Returns how many were queued.
 */
export async function queueStaleProcessing(
  db: Database,
  queue: Pick<VisualQueue, 'enqueueProcessing'>,
): Promise<number> {
  const stale = await assetsToProcess(db, PROCESSING_VERSION);
  for (const asset of stale) await queue.enqueueProcessing(asset.id);
  return stale.length;
}
