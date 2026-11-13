/**
 * OpenRouter, behind an interface (governance §15) so callers can be tested with a fake.
 *
 * - `checkKey` (F2.2, D-40): `GET /api/v1/key` with the GM's key. Key metadata only, so it
 *   generates nothing and costs nothing. A management key is refused: it can't generate.
 * - `generateImage` (F2.1, D-38): used by the style bible sample CLI now, by F2.3's job later.
 *
 * `POST /api/v1/images` takes the prompt, the reference (anchor) images as base64 data URLs,
 * an aspect ratio and a quality, and answers with base64 images and the call's cost in USD.
 * gpt-image-2 can't return a transparent background, so the background is always opaque:
 * the style bible asks for a flat key color on cutouts, removed in post-processing (F2.4).
 *
 * Plain `fetch`, no SDK. Nothing here logs or rethrows, and no error message carries the key.
 */
import type { ImageAspectRatio, ImageQuality } from '@stagehand/shared';
import { z } from 'zod';

import type { KeyCheckResult } from './key-check';

export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

export interface ReferenceImage {
  data: Buffer;
  /** e.g. `image/png`. */
  mediaType: string;
}

export interface ImageCallInput {
  apiKey: string;
  /** An OpenRouter model slug, e.g. `IMAGE_MODEL`. */
  model: string;
  prompt: string;
  /** The style bible's anchors. At most 16. */
  references: readonly ReferenceImage[];
  aspectRatio: ImageAspectRatio;
  quality: ImageQuality;
  signal?: AbortSignal;
}

/** A call that produced no image. Nothing is billed for any of these (OpenRouter bills only success). */
export type ImageFailure =
  /** OpenRouter says the key is invalid (401). */
  | { status: 'rejected' }
  /** The key may not make this call (403). */
  | { status: 'forbidden' }
  /** Out of credit (402): the GM must top up their OpenRouter account. */
  | { status: 'no_credit' }
  /** Too many requests right now (429). */
  | { status: 'rate_limited' }
  /** OpenRouter refused the request itself (400, 413, 422): its reason, for the GM. */
  | { status: 'bad_request'; message: string }
  /** The model tried and failed (502), or answered without an image. */
  | { status: 'failed' }
  /** No answer: network error, timeout, or another server error. */
  | { status: 'unreachable' }
  /** We cancelled the call. */
  | { status: 'aborted' };

export type ImageCallResult =
  | {
      status: 'ok';
      image: Buffer;
      mediaType: string;
      /** What OpenRouter charged, when it says. */
      costUsd: number | null;
    }
  | ImageFailure;

export interface OpenRouterProvider {
  checkKey(apiKey: string): Promise<KeyCheckResult>;
  generateImage(input: ImageCallInput): Promise<ImageCallResult>;
}

type Fetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface OpenRouterProviderOptions {
  /** For tests: replaces the HTTP client. */
  fetch?: Fetch;
  baseUrl?: string;
  /** An image can take a minute or two. */
  timeoutMs?: number;
  /** For the key check, which should answer in a second. */
  checkTimeoutMs?: number;
}

const keyInfoSchema = z.object({
  data: z.object({ is_management_key: z.boolean().optional() }),
});

const imageResponseSchema = z.object({
  data: z.array(z.object({ b64_json: z.string().min(1), media_type: z.string().optional() })),
  usage: z.object({ cost: z.number().nonnegative().optional() }).optional(),
});

const errorResponseSchema = z.object({
  error: z.object({ message: z.string() }),
});

/** Longest reason passed on from a refused request. */
const MESSAGE_MAX = 300;

function requestBody(input: ImageCallInput) {
  return {
    model: input.model,
    prompt: input.prompt,
    n: 1,
    aspect_ratio: input.aspectRatio,
    quality: input.quality,
    output_format: 'png',
    background: 'opaque',
    ...(input.references.length === 0
      ? {}
      : {
          input_references: input.references.map((reference) => ({
            type: 'image_url',
            image_url: {
              url: `data:${reference.mediaType};base64,${reference.data.toString('base64')}`,
            },
          })),
        }),
  };
}

async function refusalMessage(response: Response, apiKey: string): Promise<string> {
  let message = `OpenRouter refused the request (HTTP ${String(response.status)})`;
  try {
    const parsed = errorResponseSchema.safeParse(await response.json());
    if (parsed.success && parsed.data.error.message.trim() !== '') {
      message = parsed.data.error.message.trim();
    }
  } catch {
    // Not JSON: keep the generic message.
  }
  // Never pass the key on, even if a provider echoes it.
  return message.split(apiKey).join('[key]').slice(0, MESSAGE_MAX);
}

function failureOfStatus(status: number): ImageFailure | null {
  switch (status) {
    case 401:
      return { status: 'rejected' };
    case 402:
      return { status: 'no_credit' };
    case 403:
      return { status: 'forbidden' };
    case 429:
      return { status: 'rate_limited' };
    case 502:
      return { status: 'failed' };
    default:
      return null;
  }
}

export function createOpenRouterProvider(
  options: OpenRouterProviderOptions = {},
): OpenRouterProvider {
  const fetchImpl: Fetch = options.fetch ?? globalThis.fetch;
  const baseUrl = options.baseUrl ?? OPENROUTER_BASE_URL;
  const timeoutMs = options.timeoutMs ?? 5 * 60_000;
  const checkTimeoutMs = options.checkTimeoutMs ?? 10_000;

  return {
    async checkKey(apiKey) {
      let response: Response;
      try {
        response = await fetchImpl(`${baseUrl}/key`, {
          method: 'GET',
          headers: { authorization: `Bearer ${apiKey}`, 'x-title': 'Stagehand' },
          signal: AbortSignal.timeout(checkTimeoutMs),
        });
      } catch {
        return 'unreachable';
      }
      if (response.status === 401) return 'rejected';
      if (response.status === 403) return 'forbidden';
      if (response.status === 429) return 'rate_limited';
      if (!response.ok) return 'unreachable';
      try {
        const parsed = keyInfoSchema.safeParse(await response.json());
        if (!parsed.success) return 'unreachable';
        // A management key only manages other keys; it can't generate images.
        return parsed.data.data.is_management_key === true ? 'forbidden' : 'ok';
      } catch {
        return 'unreachable';
      }
    },

    async generateImage(input) {
      if (input.references.length > 16) {
        return { status: 'bad_request', message: 'At most 16 reference images' };
      }
      const timeout = AbortSignal.timeout(timeoutMs);
      const signal =
        input.signal === undefined ? timeout : AbortSignal.any([input.signal, timeout]);
      let response: Response;
      try {
        response = await fetchImpl(`${baseUrl}/images`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${input.apiKey}`,
            'content-type': 'application/json',
            // OpenRouter's app attribution: the app's name only, nothing about the GM.
            'x-title': 'Stagehand',
          },
          body: JSON.stringify(requestBody(input)),
          signal,
        });
      } catch {
        return input.signal?.aborted === true ? { status: 'aborted' } : { status: 'unreachable' };
      }

      if (!response.ok) {
        const known = failureOfStatus(response.status);
        if (known !== null) return known;
        if (response.status >= 400 && response.status < 500) {
          return {
            status: 'bad_request',
            message: await refusalMessage(response, input.apiKey),
          };
        }
        return { status: 'unreachable' };
      }

      let parsed;
      try {
        parsed = imageResponseSchema.safeParse(await response.json());
      } catch {
        return input.signal?.aborted === true ? { status: 'aborted' } : { status: 'failed' };
      }
      const first = parsed.success ? parsed.data.data[0] : undefined;
      if (!parsed.success || first === undefined) return { status: 'failed' };
      const image = Buffer.from(first.b64_json, 'base64');
      if (image.length === 0) return { status: 'failed' };
      return {
        status: 'ok',
        image,
        mediaType: first.media_type ?? 'image/png',
        costUsd: parsed.data.usage?.cost ?? null,
      };
    },
  };
}
