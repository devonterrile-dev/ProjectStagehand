import { describe, expect, it, vi } from 'vitest';

import { createAnthropicProvider } from './anthropic';

const KEY = 'sk-ant-api03-provider-test-key-0123456789';

type Fetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

function respondWith(status: number, body: unknown = {}) {
  return vi.fn<Fetch>(() =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    ),
  );
}

function errorBody(type: string) {
  return { type: 'error', error: { type, message: `${type} from the fake` } };
}

describe('createAnthropicProvider().checkKey', () => {
  it('lists models with the key and answers ok', async () => {
    const fetch = respondWith(200, { data: [], has_more: false, first_id: null, last_id: null });

    await expect(createAnthropicProvider({ fetch }).checkKey(KEY)).resolves.toBe('ok');

    expect(fetch).toHaveBeenCalledTimes(1);
    const [input, init] = fetch.mock.calls[0] ?? [];
    const url = new URL(input instanceof Request ? input.url : String(input));
    expect(url.origin).toBe('https://api.anthropic.com');
    expect(url.pathname).toBe('/v1/models');
    expect(url.searchParams.get('limit')).toBe('1');
    // SDK 1.x sends API keys as a bearer token.
    expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${KEY}`);
  });

  it.each([
    [401, 'authentication_error', 'rejected'],
    [403, 'permission_error', 'forbidden'],
    [429, 'rate_limit_error', 'rate_limited'],
    [500, 'api_error', 'unreachable'],
    [529, 'overloaded_error', 'unreachable'],
  ] as const)('maps HTTP %i to %s → %s', async (status, type, expected) => {
    const fetch = respondWith(status, errorBody(type));

    await expect(createAnthropicProvider({ fetch }).checkKey(KEY)).resolves.toBe(expected);
    // No retries: one attempt, so a bad key costs one request and the GM waits once.
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('answers unreachable when the network fails', async () => {
    const fetch = vi.fn<Fetch>(() => Promise.reject(new TypeError('fetch failed')));

    await expect(createAnthropicProvider({ fetch }).checkKey(KEY)).resolves.toBe('unreachable');
  });

  it('answers unreachable when Anthropic is too slow', async () => {
    const fetch = vi.fn(
      (_input: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'));
          });
        }),
    );

    await expect(createAnthropicProvider({ fetch, timeoutMs: 20 }).checkKey(KEY)).resolves.toBe(
      'unreachable',
    );
  });
});

// --- The import call (F1.8) -----------------------------------------------------------

type StreamEvent = Record<string, unknown> & { type: string };

/** A streamed Messages API answer, as server-sent events. */
function streamOf(events: StreamEvent[]) {
  const body = events
    .map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
    .join('');
  return vi.fn<Fetch>(() =>
    Promise.resolve(
      new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } }),
    ),
  );
}

/** The events of one answer: an optional thinking block, then the text in two pieces. */
function answer(
  text: string,
  options: { stopReason?: string; thinking?: boolean; model?: string } = {},
): StreamEvent[] {
  const half = Math.ceil(text.length / 2);
  const events: StreamEvent[] = [
    {
      type: 'message_start',
      message: {
        id: 'msg_test',
        type: 'message',
        role: 'assistant',
        model: options.model ?? 'claude-sonnet-5-5',
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: {
          input_tokens: 1200,
          output_tokens: 1,
          cache_creation_input_tokens: 300,
          cache_read_input_tokens: 2500,
        },
      },
    },
  ];
  let index = 0;
  if (options.thinking === true) {
    events.push(
      {
        type: 'content_block_start',
        index,
        content_block: { type: 'thinking', thinking: '', signature: '' },
      },
      {
        type: 'content_block_delta',
        index,
        delta: { type: 'signature_delta', signature: 'sig-abc' },
      },
      { type: 'content_block_stop', index },
    );
    index += 1;
  }
  events.push(
    { type: 'content_block_start', index, content_block: { type: 'text', text: '' } },
    {
      type: 'content_block_delta',
      index,
      delta: { type: 'text_delta', text: text.slice(0, half) },
    },
    { type: 'content_block_delta', index, delta: { type: 'text_delta', text: text.slice(half) } },
    { type: 'content_block_stop', index },
    {
      type: 'message_delta',
      delta: { stop_reason: options.stopReason ?? 'end_turn', stop_sequence: null },
      usage: { output_tokens: 640 },
    },
    { type: 'message_stop' },
  );
  return events;
}

interface SentBody {
  model: string;
  max_tokens?: number;
  stream?: boolean;
  system: { type: string; text: string; cache_control?: { type: string } }[];
  messages: { role: string; content: unknown }[];
  output_config: {
    effort: string;
    format: { type: string; schema: { properties: Record<string, unknown> } };
  };
}

function sent(fetch: ReturnType<typeof vi.fn<Fetch>>, call = 0) {
  const [input, init] = fetch.mock.calls[call] ?? [];
  const url = new URL(input instanceof Request ? input.url : String(input));
  const raw = typeof init?.body === 'string' ? init.body : '{}';
  return { url, raw, body: JSON.parse(raw) as SentBody, headers: new Headers(init?.headers) };
}

const WIRE_ANSWER = JSON.stringify({ creates: [], updates: [], links: [], questions: ['Who?'] });
const CALL = {
  apiKey: KEY,
  system: 'SYSTEM PROMPT',
  user: { prefix: '<notes>\nA port town.\n</notes>', step: '<task>\nmode: add\n</task>' },
};
/** The user message as sent: the cacheable prefix, then the step. */
const USER_CONTENT = [
  { type: 'text', text: CALL.user.prefix, cache_control: { type: 'ephemeral' } },
  { type: 'text', text: CALL.user.step },
];

describe('createAnthropicProvider().generateImport', () => {
  it('streams one request and returns the text, model, usage and the turn', async () => {
    const fetch = streamOf(answer(WIRE_ANSWER, { thinking: true }));

    const result = await createAnthropicProvider({ fetch }).generateImport(CALL);

    expect(result).toMatchObject({
      status: 'ok',
      text: WIRE_ANSWER,
      model: 'claude-sonnet-5-5',
      usage: { inputTokens: 1200, outputTokens: 640, cacheReadTokens: 2500, cacheWriteTokens: 300 },
    });
    // The turn keeps every block, thinking included, to send back on a retry.
    expect(result.status === 'ok' && result.turn.content).toMatchObject([
      { type: 'thinking', signature: 'sig-abc' },
      { type: 'text', text: WIRE_ANSWER },
    ]);

    expect(fetch).toHaveBeenCalledTimes(1);
    const { url, raw, body, headers } = sent(fetch);
    expect(url.pathname).toBe('/v1/messages');
    expect(headers.get('authorization')).toBe(`Bearer ${KEY}`);
    expect(body.model).toBe('claude-sonnet-5-5');
    expect(body.stream).toBe(true);
    expect(body.max_tokens).toBe(32_000);
    expect(body.system).toEqual([
      { type: 'text', text: 'SYSTEM PROMPT', cache_control: { type: 'ephemeral' } },
    ]);
    expect(body.messages).toEqual([{ role: 'user', content: USER_CONTENT }]);
    expect(body.output_config.effort).toBe('high');
    expect(body.output_config.format.type).toBe('json_schema');
    expect(Object.keys(body.output_config.format.schema.properties)).toEqual([
      'creates',
      'updates',
      'links',
      'questions',
    ]);
    // Nothing this model refuses: no sampling parameters, no thinking switch, no tools.
    expect(raw).not.toMatch(/"temperature"|"top_p"|"top_k"|"thinking"|"tool_choice"|"tools"/);
  });

  it('sends a schema structured output can compile', async () => {
    const fetch = streamOf(answer(WIRE_ANSWER));
    await createAnthropicProvider({ fetch }).generateImport(CALL);
    const { schema } = sent(fetch).body.output_config.format;

    // Anthropic allows few optional or union-typed properties and no open objects (D-27), so
    // every object is closed and every property required.
    interface ObjectSchema {
      type?: unknown;
      additionalProperties?: unknown;
      properties?: Record<string, unknown>;
      required?: string[];
    }
    const objects: ObjectSchema[] = [];
    const visit = (node: unknown): void => {
      if (typeof node !== 'object' || node === null) return;
      const candidate = node as ObjectSchema;
      if (candidate.type === 'object') {
        expect(candidate.additionalProperties).toBe(false);
        objects.push(candidate);
      }
      for (const child of Object.values(node)) visit(child);
    };
    visit(schema);

    // The answer itself, a create, an update, a link, a field and a point of interest.
    expect(objects).toHaveLength(6);
    for (const object of objects) {
      expect(object.required).toEqual(Object.keys(object.properties ?? {}));
    }
    expect(JSON.stringify(schema)).not.toMatch(/"anyOf"|"oneOf"|"allOf"/);
  });

  it('sends the previous turn and the problems back on a retry', async () => {
    const first = streamOf(answer(WIRE_ANSWER, { thinking: true }));
    const provider = createAnthropicProvider({ fetch: first });
    const firstResult = await provider.generateImport(CALL);
    if (firstResult.status !== 'ok') throw new Error('first call failed');

    const second = streamOf(answer(WIRE_ANSWER));
    await createAnthropicProvider({ fetch: second }).generateImport({
      ...CALL,
      retry: { previous: firstResult.turn, message: 'Fix these problems.' },
    });

    expect(sent(second).body.messages).toMatchObject([
      { role: 'user', content: USER_CONTENT },
      {
        role: 'assistant',
        content: [
          { type: 'thinking', signature: 'sig-abc' },
          { type: 'text', text: WIRE_ANSWER },
        ],
      },
      { role: 'user', content: 'Fix these problems.' },
    ]);
  });

  it.each([
    ['refusal', 'refused'],
    ['max_tokens', 'truncated'],
    ['model_context_window_exceeded', 'truncated'],
  ] as const)('reports stop reason %s as %s, with what it cost', async (stopReason, status) => {
    const fetch = streamOf(answer('{"creates": [', { stopReason }));

    const result = await createAnthropicProvider({ fetch }).generateImport(CALL);

    expect(result).toEqual({
      status,
      model: 'claude-sonnet-5-5',
      usage: { inputTokens: 1200, outputTokens: 640, cacheReadTokens: 2500, cacheWriteTokens: 300 },
    });
  });

  it.each([
    [401, 'authentication_error', { status: 'rejected' }],
    [403, 'permission_error', { status: 'forbidden' }],
    [429, 'rate_limit_error', { status: 'rate_limited' }],
    [500, 'api_error', { status: 'unreachable' }],
    [529, 'overloaded_error', { status: 'unreachable' }],
    [
      400,
      'invalid_request_error',
      { status: 'bad_request', message: 'invalid_request_error from the fake' },
    ],
  ] as const)('maps HTTP %i to a failure', async (status, type, expected) => {
    const fetch = respondWith(status, errorBody(type));

    const result = await createAnthropicProvider({ fetch, importMaxRetries: 0 }).generateImport(
      CALL,
    );

    expect(result).toEqual(expected);
  });

  it('retries a call that failed before any answer', async () => {
    const stream = streamOf(answer(WIRE_ANSWER));
    let calls = 0;
    const fetch = vi.fn<Fetch>((input, init) => {
      calls += 1;
      return calls === 1
        ? Promise.resolve(
            new Response(JSON.stringify(errorBody('overloaded_error')), {
              status: 529,
              // Tells the SDK not to wait before trying again.
              headers: { 'content-type': 'application/json', 'retry-after-ms': '1' },
            }),
          )
        : stream(input, init);
    });

    const result = await createAnthropicProvider({ fetch }).generateImport(CALL);

    expect(result.status).toBe('ok');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('answers aborted when the call is cancelled', async () => {
    const controller = new AbortController();
    const fetch = vi.fn(
      (_input: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'));
          });
        }),
    );

    const pending = createAnthropicProvider({ fetch }).generateImport({
      ...CALL,
      signal: controller.signal,
    });
    controller.abort();

    await expect(pending).resolves.toEqual({ status: 'aborted' });
  });
});

describe('createAnthropicProvider().countImportTokens', () => {
  it('counts the same request without sending it', async () => {
    const fetch = respondWith(200, { input_tokens: 4321 });

    const result = await createAnthropicProvider({ fetch }).countImportTokens(CALL);

    expect(result).toEqual({ status: 'ok', inputTokens: 4321 });
    const { url, body } = sent(fetch);
    expect(url.pathname).toBe('/v1/messages/count_tokens');
    expect(body.model).toBe('claude-sonnet-5-5');
    expect(body.system[0]?.text).toBe('SYSTEM PROMPT');
    expect(body.messages).toEqual([{ role: 'user', content: USER_CONTENT }]);
    expect(body.output_config.format.type).toBe('json_schema');
    expect(body.max_tokens).toBeUndefined();
  });

  it('maps a refused key to a failure', async () => {
    const fetch = respondWith(401, errorBody('authentication_error'));

    await expect(createAnthropicProvider({ fetch }).countImportTokens(CALL)).resolves.toEqual({
      status: 'rejected',
    });
  });
});
