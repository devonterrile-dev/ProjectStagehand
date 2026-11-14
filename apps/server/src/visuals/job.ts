/**
 * One Generate visual job (F2.3, §11 steps 3 and 5): claim the queued try, call OpenRouter with
 * the prompt and the kind's two anchors on the GM's own key, store the image, and record how
 * it ended. Post-processing (F2.4) is not here yet: the image is stored as the model sent it.
 *
 * Never throws: every way it can end is written to the asset. Only an error's kind is
 * reported; the prompt (private campaign text) and the key never reach a log.
 */
import type { VisualErrorCode } from '@stagehand/shared';

import {
  claimVisual,
  finishVisual,
  type ClaimedVisual,
  type VisualOutcome,
} from '../campaigns/visuals';
import { CredentialUnreadableError } from '../credentials/crypto';
import { getProviderKey } from '../credentials/store';
import type { Database } from '../db/client';
import type { ImageCallResult, ImageFailure, OpenRouterProvider } from '../providers/openrouter';

import type { ReferencesByKind } from './references';
import { extensionOf, originalKey, type AssetStorage } from './storage';

export interface VisualJobDeps {
  db: Database;
  /** CREDENTIALS_ENCRYPTION_KEY, to decrypt the GM's OpenRouter key. */
  credentialsKey: Buffer;
  openrouter: Pick<OpenRouterProvider, 'generateImage'>;
  storage: AssetStorage;
  references: ReferencesByKind;
  /** How long to wait before the one retry of a rate-limited call. */
  rateLimitPauseMs?: number;
  /** Told the kind of an unexpected error, never its message. */
  onError?: (assetId: string, errorName: string) => void;
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
  return { ok: true, key, mediaType: call.mediaType, costUsd: call.costUsd };
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
    deps.onError?.(assetId, error instanceof Error ? error.name : 'unknown');
    if (claimed !== null) {
      await finishVisual(deps.db, assetId, { ok: false, errorCode: 'internal' }).catch(() => {
        // The database is gone too; the startup sweep marks it interrupted.
      });
    }
  }
}
