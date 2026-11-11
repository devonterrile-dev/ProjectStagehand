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
