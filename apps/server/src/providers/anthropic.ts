/**
 * Anthropic, behind an interface (governance §15) so routes can be tested with a fake.
 *
 * F1.7 needs only a key check: `GET /v1/models` with the GM's key. It's free (no tokens) and
 * proves Anthropic accepts the key (D-26). The F1.8 import call will join it here.
 */
import Anthropic, {
  AuthenticationError,
  PermissionDeniedError,
  RateLimitError,
  type ClientOptions,
} from '@anthropic-ai/sdk';

/**
 * - `ok`: Anthropic accepted the key.
 * - `rejected`: Anthropic says the key is invalid (401).
 * - `forbidden`: the key is valid but may not use the API (403).
 * - `rate_limited`: Anthropic is rate limiting the key right now (429).
 * - `unreachable`: no answer, a timeout, or an Anthropic-side error.
 */
export type KeyCheckResult = 'ok' | 'rejected' | 'forbidden' | 'rate_limited' | 'unreachable';

export interface AnthropicProvider {
  checkKey(apiKey: string): Promise<KeyCheckResult>;
}

export interface AnthropicProviderOptions {
  /** For tests: replaces the HTTP client. */
  fetch?: ClientOptions['fetch'];
  timeoutMs?: number;
}

export function createAnthropicProvider(options: AnthropicProviderOptions = {}): AnthropicProvider {
  return {
    async checkKey(apiKey) {
      const client = new Anthropic({
        // Passing the key means the SDK ignores any credentials in our own environment.
        apiKey,
        maxRetries: 0,
        timeout: options.timeoutMs ?? 10_000,
        // The SDK must never write anything (a request, a header) to our logs.
        logLevel: 'off',
        openTelemetry: false,
        ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
      });
      try {
        await client.models.list({ limit: 1 });
        return 'ok';
      } catch (error) {
        return classify(error);
      }
    },
  };
}

/**
 * Maps an SDK error to a result; anything but a clear 401, 403 or 429 (a connection error, a
 * timeout, a 5xx) means we couldn't check. The error itself is dropped, never logged or
 * rethrown.
 */
function classify(error: unknown): KeyCheckResult {
  if (error instanceof AuthenticationError) return 'rejected';
  if (error instanceof PermissionDeniedError) return 'forbidden';
  if (error instanceof RateLimitError) return 'rate_limited';
  return 'unreachable';
}
