import { describe, expect, it, vi } from 'vitest';

import { createOpenRouterProvider, type ImageCallInput } from './openrouter';

const KEY = 'sk-or-v1-provider-test-key-0123456789abcdef';
const PNG = Buffer.from('fake png bytes');

type Fetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

function respondWith(status: number, body: unknown = {}) {
  return vi.fn<Fetch>(() =>
    Promise.resolve(
      new Response(typeof body === 'string' ? body : JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    ),
  );
}

function input(overrides: Partial<ImageCallInput> = {}): ImageCallInput {
  return {
    apiKey: KEY,
    model: 'openai/gpt-image-2',
    prompt: 'Draw a well.',
    references: [],
    aspectRatio: '1:1',
    quality: 'medium',
    ...overrides,
  };
}

const OK_BODY = {
  created: 1,
  data: [{ b64_json: PNG.toString('base64'), media_type: 'image/png' }],
  usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30, cost: 0.0612 },
};

function sentBody(fetch: ReturnType<typeof respondWith>): Record<string, unknown> {
  const init = fetch.mock.calls[0]?.[1];
  return JSON.parse(init?.body as string) as Record<string, unknown>;
}

describe('createOpenRouterProvider().generateImage', () => {
  it('posts the prompt with an opaque png request and returns the image and its cost', async () => {
    const fetch = respondWith(200, OK_BODY);

    const result = await createOpenRouterProvider({ fetch }).generateImage(input());

    expect(result).toEqual({ status: 'ok', image: PNG, mediaType: 'image/png', costUsd: 0.0612 });
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe('https://openrouter.ai/api/v1/images');
    expect(init?.method).toBe('POST');
    expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${KEY}`);
    expect(sentBody(fetch)).toEqual({
      model: 'openai/gpt-image-2',
      prompt: 'Draw a well.',
      n: 1,
      aspect_ratio: '1:1',
      quality: 'medium',
      output_format: 'png',
      background: 'opaque',
    });
  });

  it('sends reference images as base64 data URLs', async () => {
    const fetch = respondWith(200, OK_BODY);
    const anchor = Buffer.from([1, 2, 3, 250]);

    await createOpenRouterProvider({ fetch }).generateImage(
      input({ references: [{ data: anchor, mediaType: 'image/png' }] }),
    );

    expect(sentBody(fetch)['input_references']).toEqual([
      {
        type: 'image_url',
        image_url: { url: `data:image/png;base64,${anchor.toString('base64')}` },
      },
    ]);
  });

  it('refuses more than 16 references without calling OpenRouter', async () => {
    const fetch = respondWith(200, OK_BODY);
    const references = Array.from({ length: 17 }, () => ({ data: PNG, mediaType: 'image/png' }));

    const result = await createOpenRouterProvider({ fetch }).generateImage(input({ references }));

    expect(result.status).toBe('bad_request');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('defaults the media type and a missing cost', async () => {
    const fetch = respondWith(200, { data: [{ b64_json: PNG.toString('base64') }] });

    await expect(createOpenRouterProvider({ fetch }).generateImage(input())).resolves.toEqual({
      status: 'ok',
      image: PNG,
      mediaType: 'image/png',
      costUsd: null,
    });
  });

  it.each([
    [401, 'rejected'],
    [402, 'no_credit'],
    [403, 'forbidden'],
    [429, 'rate_limited'],
    [502, 'failed'],
    [500, 'unreachable'],
    [503, 'unreachable'],
  ] as const)('maps HTTP %i to %s', async (status, expected) => {
    const fetch = respondWith(status, { error: { message: 'from the fake', code: status } });

    await expect(createOpenRouterProvider({ fetch }).generateImage(input())).resolves.toEqual({
      status: expected,
    });
  });

  it("passes on OpenRouter's reason for a refused request, without the key", async () => {
    const fetch = respondWith(400, {
      error: { message: `Your request was rejected by the safety system. Key ${KEY}`, code: 400 },
    });

    const result = await createOpenRouterProvider({ fetch }).generateImage(input());

    expect(result).toEqual({
      status: 'bad_request',
      message: 'Your request was rejected by the safety system. Key [key]',
    });
  });

  it('gives a plain reason when a refusal is not JSON', async () => {
    const fetch = respondWith(413, 'too big');

    await expect(createOpenRouterProvider({ fetch }).generateImage(input())).resolves.toEqual({
      status: 'bad_request',
      message: 'OpenRouter refused the request (HTTP 413)',
    });
  });

  it.each([
    ['no images', { data: [] }],
    ['an empty image', { data: [{ b64_json: '' }] }],
    ['another shape', { images: [] }],
    ['not JSON', 'oops'],
  ])('fails on an answer with %s', async (_name, body) => {
    const fetch = respondWith(200, body);

    await expect(createOpenRouterProvider({ fetch }).generateImage(input())).resolves.toEqual({
      status: 'failed',
    });
  });

  it('answers unreachable when the network fails or OpenRouter is too slow', async () => {
    const down = vi.fn<Fetch>(() => Promise.reject(new TypeError('fetch failed')));
    await expect(createOpenRouterProvider({ fetch: down }).generateImage(input())).resolves.toEqual(
      { status: 'unreachable' },
    );

    const slow = vi.fn<Fetch>(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('timed out', 'TimeoutError'));
          });
        }),
    );
    await expect(
      createOpenRouterProvider({ fetch: slow, timeoutMs: 10 }).generateImage(input()),
    ).resolves.toEqual({ status: 'unreachable' });
  });

  it('answers aborted when the caller cancels', async () => {
    const controller = new AbortController();
    const fetch = vi.fn<Fetch>(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'));
          });
        }),
    );

    const pending = createOpenRouterProvider({ fetch }).generateImage(
      input({ signal: controller.signal }),
    );
    controller.abort();

    await expect(pending).resolves.toEqual({ status: 'aborted' });
  });
});

describe('createOpenRouterProvider().checkKey', () => {
  const keyInfo = (isManagementKey?: boolean) => ({
    data: {
      label: 'sk-or-v1-abc...xyz',
      usage: 0,
      limit: null,
      is_free_tier: false,
      ...(isManagementKey === undefined ? {} : { is_management_key: isManagementKey }),
    },
  });

  it('asks for the key info with the key and answers ok', async () => {
    const fetch = respondWith(200, keyInfo(false));

    await expect(createOpenRouterProvider({ fetch }).checkKey(KEY)).resolves.toBe('ok');

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe('https://openrouter.ai/api/v1/key');
    expect(init?.method).toBe('GET');
    expect(init?.body).toBeUndefined();
    expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${KEY}`);
  });

  it('accepts a key whose info leaves out the management flag', async () => {
    const fetch = respondWith(200, keyInfo());
    await expect(createOpenRouterProvider({ fetch }).checkKey(KEY)).resolves.toBe('ok');
  });

  it('refuses a management key: it cannot generate images', async () => {
    const fetch = respondWith(200, keyInfo(true));
    await expect(createOpenRouterProvider({ fetch }).checkKey(KEY)).resolves.toBe('forbidden');
  });

  it.each([
    [401, 'rejected'],
    [403, 'forbidden'],
    [429, 'rate_limited'],
    [500, 'unreachable'],
    [502, 'unreachable'],
  ] as const)('maps HTTP %i to %s, in one attempt', async (status, expected) => {
    const fetch = respondWith(status, { error: { message: 'from the fake', code: status } });

    await expect(createOpenRouterProvider({ fetch }).checkKey(KEY)).resolves.toBe(expected);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('answers unreachable on an answer it cannot read', async () => {
    await expect(
      createOpenRouterProvider({ fetch: respondWith(200, 'oops') }).checkKey(KEY),
    ).resolves.toBe('unreachable');
    await expect(
      createOpenRouterProvider({ fetch: respondWith(200, { nope: true }) }).checkKey(KEY),
    ).resolves.toBe('unreachable');
  });

  it('answers unreachable when the network fails or OpenRouter is too slow', async () => {
    const down = vi.fn<Fetch>(() => Promise.reject(new TypeError('fetch failed')));
    await expect(createOpenRouterProvider({ fetch: down }).checkKey(KEY)).resolves.toBe(
      'unreachable',
    );

    const slow = vi.fn<Fetch>(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('timed out', 'TimeoutError'));
          });
        }),
    );
    await expect(
      createOpenRouterProvider({ fetch: slow, checkTimeoutMs: 10 }).checkKey(KEY),
    ).resolves.toBe('unreachable');
  });
});
