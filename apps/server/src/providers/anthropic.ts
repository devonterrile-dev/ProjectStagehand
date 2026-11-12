/**
 * Anthropic, behind an interface (governance §15) so routes can be tested with a fake.
 *
 * - `checkKey` (F1.7, D-26): `GET /v1/models` with the GM's key. Free, and proves Anthropic
 *   accepts the key.
 * - `generateImport` and `countImportTokens` (F1.8, D-27): the AI import call, and its free
 *   input-token count for the cost estimate.
 *
 * Nothing here logs or rethrows: an SDK error can carry the request, so each one is reduced
 * to a status the caller can act on.
 */
import Anthropic, {
  APIUserAbortError,
  AuthenticationError,
  BadRequestError,
  PermissionDeniedError,
  RateLimitError,
  type ClientOptions,
} from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import {
  AI_IMPORT_EFFORT,
  AI_IMPORT_LIMITS,
  AI_IMPORT_MODEL,
  importWireSchema,
  type TokenUsage,
} from '@stagehand/shared';

/**
 * - `ok`: Anthropic accepted the key.
 * - `rejected`: Anthropic says the key is invalid (401).
 * - `forbidden`: the key is valid but may not use the API (403).
 * - `rate_limited`: Anthropic is rate limiting the key right now (429).
 * - `unreachable`: no answer, a timeout, or an Anthropic-side error.
 */
export type KeyCheckResult = 'ok' | 'rejected' | 'forbidden' | 'rate_limited' | 'unreachable';

/** A call that never got an answer from the model. */
export type ProviderFailure =
  | { status: Exclude<KeyCheckResult, 'ok'> }
  /** Anthropic refused the request itself (400): too large, out of credit, malformed. */
  | { status: 'bad_request'; message: string }
  /** We cancelled the call (the server is shutting down). */
  | { status: 'aborted' };

/**
 * The model's turn, to send back unchanged when its answer needs correcting. Opaque to
 * callers: it holds the SDK's content blocks, thinking included, which Anthropic requires
 * back exactly as they came.
 */
export interface ImportTurn {
  readonly content: unknown;
}

export interface ImportCallInput {
  apiKey: string;
  /** The filled prompt file. The same for every import, so Anthropic can cache it. */
  system: string;
  /** The campaign context, the task and the GM's notes. */
  /**
   * The user message (`ai-import/prompt.ts`): `prefix` (campaign and notes) is the same over an
   * import's rounds, so it is marked cacheable; `step` follows it.
   */
  user: { prefix: string; step: string };
  /** Second attempt: the first answer and what was wrong with it. */
  retry?: { previous: ImportTurn; message: string };
  /** Cancels the call. */
  signal?: AbortSignal;
}

export type ImportCallResult =
  /** `text` is the answer: JSON in the shape of `importWireSchema`. */
  | { status: 'ok'; text: string; model: string; usage: TokenUsage; turn: ImportTurn }
  /** The model declined (`refused`) or ran out of output room (`truncated`). */
  | { status: 'refused' | 'truncated'; model: string; usage: TokenUsage }
  | ProviderFailure;

export type TokenCountResult = { status: 'ok'; inputTokens: number } | ProviderFailure;

export interface AnthropicProvider {
  checkKey(apiKey: string): Promise<KeyCheckResult>;
  generateImport(input: ImportCallInput): Promise<ImportCallResult>;
  countImportTokens(
    input: Pick<ImportCallInput, 'apiKey' | 'system' | 'user'>,
  ): Promise<TokenCountResult>;
}

export interface AnthropicProviderOptions {
  /** For tests: replaces the HTTP client. */
  fetch?: ClientOptions['fetch'];
  /** For the quick calls: the key check and the token count. */
  timeoutMs?: number;
  /** For the import call, which can run for minutes. */
  importTimeoutMs?: number;
  /** How often the SDK retries an import call that failed before any answer (429, 5xx). */
  importMaxRetries?: number;
}

/**
 * The answer's shape as Anthropic's structured output takes it. Only the schema is sent: we
 * parse and check the answer ourselves (`ai-import/generate.ts`), so a cut-off answer becomes
 * a status here instead of a parse error thrown by the SDK.
 */
const WIRE_FORMAT = (() => {
  const { type, schema } = zodOutputFormat(importWireSchema);
  return { type, schema };
})();

type MessageParams = Parameters<Anthropic['messages']['stream']>[0];

function importRequest(input: Pick<ImportCallInput, 'system' | 'user' | 'retry'>) {
  const messages: MessageParams['messages'] = [
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text: input.user.prefix,
          cache_control: { type: 'ephemeral' },
        },
        { type: 'text', text: input.user.step },
      ],
    },
  ];
  if (input.retry !== undefined) {
    messages.push(
      {
        role: 'assistant',
        content: input.retry.previous.content as Extract<
          MessageParams['messages'][number],
          { role: 'assistant' }
        >['content'],
      },
      { role: 'user', content: input.retry.message },
    );
  }
  return {
    model: AI_IMPORT_MODEL,
    // The prompt file is identical across imports, and the start of the user message across
    // an import's rounds: both are marked cacheable. Every step sends the same output format
    // and effort, so nothing else breaks the cache between rounds.
    system: [
      { type: 'text' as const, text: input.system, cache_control: { type: 'ephemeral' as const } },
    ],
    messages,
    // No sampling parameters and no `thinking`: the model thinks adaptively by default, and
    // `effort` sets how much.
    output_config: { effort: AI_IMPORT_EFFORT, format: WIRE_FORMAT },
  } satisfies Partial<MessageParams>;
}

function usageOf(usage: {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number | null;
  cache_creation_input_tokens: number | null;
}): TokenUsage {
  return {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cacheReadTokens: usage.cache_read_input_tokens ?? 0,
    cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
  };
}

export function createAnthropicProvider(options: AnthropicProviderOptions = {}): AnthropicProvider {
  const client = (apiKey: string, overrides: Pick<ClientOptions, 'timeout' | 'maxRetries'>) =>
    new Anthropic({
      // Passing the key means the SDK ignores any credentials in our own environment.
      apiKey,
      ...overrides,
      // The SDK must never write anything (a request, a header) to our logs.
      logLevel: 'off',
      openTelemetry: false,
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    });
  const quick = (apiKey: string) =>
    client(apiKey, { maxRetries: 0, timeout: options.timeoutMs ?? 10_000 });

  return {
    async checkKey(apiKey) {
      try {
        await quick(apiKey).models.list({ limit: 1 });
        return 'ok';
      } catch (error) {
        return classify(error);
      }
    },

    async generateImport(input) {
      const anthropic = client(input.apiKey, {
        maxRetries: options.importMaxRetries ?? 2,
        timeout: options.importTimeoutMs ?? 10 * 60_000,
      });
      try {
        // Streamed, so a long answer can't hit an idle timeout; only the whole message is used.
        const message = await anthropic.messages
          .stream(
            { ...importRequest(input), max_tokens: AI_IMPORT_LIMITS.maxOutputTokens },
            input.signal === undefined ? {} : { signal: input.signal },
          )
          .finalMessage();
        const usage = usageOf(message.usage);
        if (message.stop_reason === 'refusal') {
          return { status: 'refused', model: message.model, usage };
        }
        if (message.stop_reason !== 'end_turn') {
          // `max_tokens`, or the context window ran out: the JSON is incomplete either way.
          return { status: 'truncated', model: message.model, usage };
        }
        const text = message.content
          .flatMap((block) => (block.type === 'text' ? [block.text] : []))
          .join('');
        return {
          status: 'ok',
          text,
          model: message.model,
          usage,
          turn: { content: message.content },
        };
      } catch (error) {
        return failureOf(error);
      }
    },

    async countImportTokens(input) {
      try {
        const count = await quick(input.apiKey).messages.countTokens(importRequest(input));
        return { status: 'ok', inputTokens: count.input_tokens };
      } catch (error) {
        return failureOf(error);
      }
    },
  };
}

/**
 * Maps an SDK error to a result; anything but a clear 401, 403 or 429 (a connection error, a
 * timeout, a 5xx) means we couldn't check. The error itself is dropped, never logged or
 * rethrown.
 */
function classify(error: unknown): Exclude<KeyCheckResult, 'ok'> {
  if (error instanceof AuthenticationError) return 'rejected';
  if (error instanceof PermissionDeniedError) return 'forbidden';
  if (error instanceof RateLimitError) return 'rate_limited';
  return 'unreachable';
}

/** Anthropic's own words for a 400, cut short. They describe the request, not its content. */
const BAD_REQUEST_MESSAGE_MAX = 500;

function failureOf(error: unknown): ProviderFailure {
  if (error instanceof APIUserAbortError) return { status: 'aborted' };
  if (error instanceof BadRequestError) {
    const message = (error.apiMessage ?? 'The request was refused.').slice(
      0,
      BAD_REQUEST_MESSAGE_MAX,
    );
    return { status: 'bad_request', message };
  }
  return { status: classify(error) };
}
