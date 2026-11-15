import { afterEach, describe, expect, it, vi } from 'vitest';

import { createDiscordProvider } from './discord';

const APP = { clientId: 'client-123', clientSecret: 'secret-456' };

/** Answers every call to Discord; returns what was sent. */
function fakeDiscord(answer: () => Response | Promise<Response>) {
  const sent: { url: string; init: RequestInit | undefined }[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    sent.push({ url: input instanceof Request ? input.url : String(input), init });
    return answer();
  });
  return sent;
}

describe('Discord provider', () => {
  const discord = createDiscordProvider(APP);

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('exchangeCode', () => {
    it("exchanges a code for the user's token, with the application's secret", async () => {
      const sent = fakeDiscord(() =>
        Response.json({
          access_token: 'token-abc',
          refresh_token: 'refresh-abc',
          scope: 'identify  rpc.voice.read',
        }),
      );

      expect(await discord.exchangeCode('code-1')).toEqual({
        status: 'ok',
        accessToken: 'token-abc',
        scopes: ['identify', 'rpc.voice.read'],
      });
      expect(sent).toHaveLength(1);
      expect(sent[0]?.url).toBe('https://discord.com/api/oauth2/token');
      expect(sent[0]?.init?.method).toBe('POST');
      expect(Object.fromEntries(sent[0]?.init?.body as URLSearchParams)).toEqual({
        client_id: 'client-123',
        client_secret: 'secret-456',
        grant_type: 'authorization_code',
        code: 'code-1',
      });
    });

    it('says refused, with only the status, when Discord turns the code down', async () => {
      fakeDiscord(() => Response.json({ error: 'invalid_grant' }, { status: 400 }));

      expect(await discord.exchangeCode('code-1')).toEqual({
        status: 'refused',
        discordStatus: 400,
      });
    });

    it('says unreachable when there is no answer, and garbled when it makes no sense', async () => {
      fakeDiscord(() => Promise.reject(new TypeError('fetch failed')));
      expect(await discord.exchangeCode('code-1')).toEqual({ status: 'unreachable' });

      vi.restoreAllMocks();
      fakeDiscord(() => new Response('<html>busy</html>'));
      expect(await discord.exchangeCode('code-1')).toEqual({ status: 'garbled' });

      vi.restoreAllMocks();
      fakeDiscord(() => Response.json({ scope: 'identify' }));
      expect(await discord.exchangeCode('code-1')).toEqual({ status: 'garbled' });
    });
  });

  describe('userOf', () => {
    it('asks Discord who the token belongs to, and keeps only the id', async () => {
      const sent = fakeDiscord(() =>
        Response.json({ id: '80351110224678912', username: 'nelly', email: 'nelly@example.com' }),
      );

      expect(await discord.userOf('token-abc')).toEqual({ status: 'ok', id: '80351110224678912' });
      expect(sent[0]?.url).toBe('https://discord.com/api/users/@me');
      expect(new Headers(sent[0]?.init?.headers).get('authorization')).toBe('Bearer token-abc');
      // The application's secret is for the code exchange only.
      expect(JSON.stringify(sent[0]?.init)).not.toContain('secret-456');
    });

    it('says refused for a token Discord no longer accepts', async () => {
      fakeDiscord(() => Response.json({ message: '401: Unauthorized' }, { status: 401 }));

      expect(await discord.userOf('token-abc')).toEqual({ status: 'refused', discordStatus: 401 });
    });

    it('says unreachable or garbled like the code exchange', async () => {
      fakeDiscord(() => Promise.reject(new TypeError('fetch failed')));
      expect(await discord.userOf('token-abc')).toEqual({ status: 'unreachable' });

      vi.restoreAllMocks();
      fakeDiscord(() => Response.json({ username: 'no id' }));
      expect(await discord.userOf('token-abc')).toEqual({ status: 'garbled' });
    });
  });
});
