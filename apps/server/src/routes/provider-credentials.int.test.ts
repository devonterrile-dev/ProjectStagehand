/**
 * GMs' stored API keys (F1.7, F2.2; governance §14, D-26, D-40), against a real Postgres.
 * Covers saving, replacing and removing a key, the Anthropic and OpenRouter checks (faked),
 * isolation between users and between providers, and the two §14 checks: no response ever
 * carries a key, and no log line does either.
 */
import { Writable } from 'node:stream';

import type { ProviderCredential, ProviderCredentialsResponse } from '@stagehand/shared';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  buildTestApp,
  discordUser,
  SAME_ORIGIN,
  signIn,
  TEST_CREDENTIALS_KEY,
} from '../../test/auth-helpers';
import { credentialAad, CredentialUnreadableError, decryptCredential } from '../credentials/crypto';
import { getProviderKey } from '../credentials/store';
import type { DbHandle } from '../db/client';
import { providerCredentials, users } from '../db/schema';
import type { KeyCheckResult } from '../providers/key-check';

type Method = 'GET' | 'PUT' | 'DELETE';

interface Person {
  cookie: string;
  id: string;
}

const KEY_A = 'sk-ant-api03-AliceAliceAliceAlice0123456789_-alc1';
const KEY_A2 = 'sk-ant-api03-AliceSecondKeySecondKey987654321-alc2';
const KEY_B = 'sk-ant-api03-BobBobBobBobBobBobBob0123456789__bob1';
const BAD_KEY = 'sk-ant-api03-ThisOneIsRefusedByAnthropic000000-bad1';
const OR_A = `sk-or-v1-${'a11ce0123456789a'.repeat(4)}`;
const OR_B = `sk-or-v1-${'b0b0b0123456789b'.repeat(4)}`;
const OR_BAD = `sk-or-v1-${'bad0bad123456789'.repeat(4)}`;
const ALL_KEYS = [KEY_A, KEY_A2, KEY_B, BAD_KEY, OR_A, OR_B, OR_BAD];

const URL_LIST = '/api/me/credentials';
const URL_ANTHROPIC = '/api/me/credentials/anthropic';
const URL_OPENROUTER = '/api/me/credentials/openrouter';

describe('Provider credentials', () => {
  let app: FastifyInstance;
  let handle: DbHandle;
  let alice: Person;
  let bob: Person;
  /** What the fake Anthropic answers next. */
  let nextCheck: KeyCheckResult = 'ok';
  const checkedKeys: string[] = [];
  /** What the fake OpenRouter answers next. */
  let nextOpenRouterCheck: KeyCheckResult = 'ok';
  const openRouterChecked: string[] = [];
  const logLines: string[] = [];
  const responseBodies: string[] = [];

  beforeAll(async () => {
    const logStream = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        logLines.push(chunk.toString('utf8'));
        callback();
      },
    });
    ({ app, handle } = await buildTestApp({
      logger: { level: 'trace', stream: logStream },
      anthropic: {
        checkKey: (apiKey) => {
          checkedKeys.push(apiKey);
          return Promise.resolve(nextCheck);
        },
      },
      openrouter: {
        checkKey: (apiKey) => {
          openRouterChecked.push(apiKey);
          return Promise.resolve(nextOpenRouterCheck);
        },
      },
    }));
    async function person(discordId: string, name: string): Promise<Person> {
      const cookie = await signIn(app, discordUser({ id: discordId, global_name: name }));
      const [row] = await handle.db.select().from(users).where(eq(users.discordId, discordId));
      return { cookie, id: row?.id ?? '' };
    }
    alice = await person('8001', 'Alice');
    bob = await person('8002', 'Bob');
  });

  afterAll(async () => {
    await app.close();
  });

  async function call(
    method: Method,
    url: string,
    who: Person | null,
    payload?: Record<string, unknown>,
    headers: Record<string, string> = SAME_ORIGIN,
  ) {
    const response = await app.inject({
      method,
      url,
      headers: { ...headers, cookie: who?.cookie ?? '' },
      ...(payload === undefined ? {} : { payload }),
    });
    responseBodies.push(`${JSON.stringify(response.headers)}\n${response.body}`);
    return response;
  }

  async function rowsOf(who: Person) {
    return handle.db
      .select()
      .from(providerCredentials)
      .where(eq(providerCredentials.userId, who.id));
  }

  async function save(who: Person, apiKey: string, result: KeyCheckResult = 'ok') {
    nextCheck = result;
    try {
      return await call('PUT', URL_ANTHROPIC, who, { apiKey });
    } finally {
      nextCheck = 'ok';
    }
  }

  it('starts with no keys', async () => {
    const response = await call('GET', URL_LIST, alice);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ credentials: [] });
  });

  it('checks a key with Anthropic, stores it encrypted and shows only the last four', async () => {
    const before = Date.now();
    const response = await save(alice, `  ${KEY_A}\n`);

    expect(response.statusCode).toBe(200);
    const saved = response.json<ProviderCredential>();
    expect(Object.keys(saved).sort()).toEqual(['createdAt', 'lastFour', 'provider']);
    expect(saved).toMatchObject({ provider: 'anthropic', lastFour: 'alc1' });
    expect(Date.parse(saved.createdAt)).toBeGreaterThanOrEqual(before - 1000);
    // The trimmed key is what gets checked and stored.
    expect(checkedKeys.at(-1)).toBe(KEY_A);

    const [row] = await rowsOf(alice);
    expect(row?.lastFour).toBe('alc1');
    expect(row?.encryptedKey).toMatch(/^v1\./);
    expect(row?.encryptedKey).not.toContain(KEY_A);
    expect(row?.encryptedKey).not.toContain(KEY_A.slice(13, 40));
    expect(
      decryptCredential(
        TEST_CREDENTIALS_KEY,
        row?.encryptedKey ?? '',
        credentialAad(alice.id, 'anthropic'),
      ),
    ).toBe(KEY_A);

    const list = await call('GET', URL_LIST, alice);
    expect(list.json<ProviderCredentialsResponse>()).toEqual({ credentials: [saved] });
  });

  it('replaces a key, resetting its date', async () => {
    const [before] = await rowsOf(alice);
    const response = await save(alice, KEY_A2);

    expect(response.statusCode).toBe(200);
    expect(response.json<ProviderCredential>().lastFour).toBe('alc2');
    const rows = await rowsOf(alice);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.encryptedKey).not.toBe(before?.encryptedKey);
    expect(rows[0]?.createdAt.getTime()).toBeGreaterThanOrEqual(before?.createdAt.getTime() ?? 0);
    expect(await getProviderKey(handle.db, TEST_CREDENTIALS_KEY, alice.id, 'anthropic')).toBe(
      KEY_A2,
    );
  });

  it.each([
    ['rejected', 400, "Anthropic didn't accept this key"],
    ['forbidden', 400, "won't let it use the API"],
    ['rate_limited', 503, 'rate limiting this key'],
    ['unreachable', 502, "Couldn't reach Anthropic"],
  ] as const)('stores nothing when Anthropic answers %s', async (result, status, message) => {
    const response = await save(bob, BAD_KEY, result);

    expect(response.statusCode).toBe(status);
    expect(response.json<{ message: string }>().message).toContain(message);
    expect(response.json<{ message: string }>().message).toContain('Nothing was saved.');
    expect(await rowsOf(bob)).toEqual([]);
  });

  it('keeps the old key when a replacement is refused', async () => {
    const response = await save(alice, BAD_KEY, 'rejected');

    expect(response.statusCode).toBe(400);
    expect(await getProviderKey(handle.db, TEST_CREDENTIALS_KEY, alice.id, 'anthropic')).toBe(
      KEY_A2,
    );
  });

  it('refuses a malformed key before asking Anthropic', async () => {
    const checksBefore = checkedKeys.length;
    for (const payload of [
      { apiKey: 'sk-proj-notanthropicatall0123456789' },
      { apiKey: 'sk-ant-admin01-AdminKeyAdminKeyAdminKey0123' },
      { apiKey: '' },
      {},
      { apiKey: KEY_B, extra: true },
    ]) {
      const response = await call('PUT', URL_ANTHROPIC, bob, payload);
      expect(response.statusCode).toBe(400);
    }

    expect(checkedKeys).toHaveLength(checksBefore);
    expect(await rowsOf(bob)).toEqual([]);
  });

  it('keeps each user to their own key', async () => {
    expect((await save(bob, KEY_B)).statusCode).toBe(200);

    expect(
      (await call('GET', URL_LIST, alice)).json<ProviderCredentialsResponse>().credentials,
    ).toEqual([expect.objectContaining({ lastFour: 'alc2' })]);
    expect(
      (await call('GET', URL_LIST, bob)).json<ProviderCredentialsResponse>().credentials,
    ).toEqual([expect.objectContaining({ lastFour: 'bob1' })]);
    expect(await getProviderKey(handle.db, TEST_CREDENTIALS_KEY, bob.id, 'anthropic')).toBe(KEY_B);
  });

  it("can't use a value copied onto another user's row", async () => {
    const [aliceRow] = await rowsOf(alice);
    const [bobRow] = await rowsOf(bob);
    await handle.db
      .update(providerCredentials)
      .set({ encryptedKey: aliceRow?.encryptedKey ?? '' })
      .where(eq(providerCredentials.userId, bob.id));

    await expect(
      getProviderKey(handle.db, TEST_CREDENTIALS_KEY, bob.id, 'anthropic'),
    ).rejects.toThrow(CredentialUnreadableError);
    await expect(
      getProviderKey(handle.db, Buffer.alloc(32, 1), alice.id, 'anthropic'),
    ).rejects.toThrow(CredentialUnreadableError);

    await handle.db
      .update(providerCredentials)
      .set({ encryptedKey: bobRow?.encryptedKey ?? '' })
      .where(eq(providerCredentials.userId, bob.id));
  });

  it('removes a key, and removing again is fine', async () => {
    expect((await call('DELETE', URL_ANTHROPIC, bob)).statusCode).toBe(204);
    expect(await rowsOf(bob)).toEqual([]);
    expect(await getProviderKey(handle.db, TEST_CREDENTIALS_KEY, bob.id, 'anthropic')).toBeNull();
    expect((await call('DELETE', URL_ANTHROPIC, bob)).statusCode).toBe(204);
    // Alice's key is untouched.
    expect(await rowsOf(alice)).toHaveLength(1);
  });

  it('needs a session', async () => {
    expect((await call('GET', URL_LIST, null)).statusCode).toBe(401);
    expect((await call('PUT', URL_ANTHROPIC, null, { apiKey: KEY_B })).statusCode).toBe(401);
    expect((await call('DELETE', URL_ANTHROPIC, null)).statusCode).toBe(401);
  });

  it('blocks cross-origin writes', async () => {
    const evil = { origin: 'https://evil.example' };
    expect((await call('PUT', URL_ANTHROPIC, bob, { apiKey: KEY_B }, evil)).statusCode).toBe(403);
    expect((await call('DELETE', URL_ANTHROPIC, alice, undefined, evil)).statusCode).toBe(403);
    expect(await rowsOf(bob)).toEqual([]);
    expect(await rowsOf(alice)).toHaveLength(1);
  });

  async function saveOpenRouter(who: Person, apiKey: string, result: KeyCheckResult = 'ok') {
    nextOpenRouterCheck = result;
    try {
      return await call('PUT', URL_OPENROUTER, who, { apiKey });
    } finally {
      nextOpenRouterCheck = 'ok';
    }
  }

  describe('OpenRouter (F2.2)', () => {
    it('checks a key with OpenRouter and stores it beside the Anthropic key', async () => {
      const anthropicChecksBefore = checkedKeys.length;
      const response = await saveOpenRouter(alice, `  ${OR_A} `);

      expect(response.statusCode).toBe(200);
      const saved = response.json<ProviderCredential>();
      expect(saved).toMatchObject({ provider: 'openrouter', lastFour: OR_A.slice(-4) });
      expect(openRouterChecked.at(-1)).toBe(OR_A);
      // Anthropic is never asked about an OpenRouter key.
      expect(checkedKeys).toHaveLength(anthropicChecksBefore);

      const list = await call('GET', URL_LIST, alice);
      expect(list.json<ProviderCredentialsResponse>().credentials.map((c) => c.provider)).toEqual([
        'anthropic',
        'openrouter',
      ]);
      expect(await getProviderKey(handle.db, TEST_CREDENTIALS_KEY, alice.id, 'openrouter')).toBe(
        OR_A,
      );
      // Stored encrypted, bound to its own provider: the Anthropic AAD can't open it.
      const [row] = (await rowsOf(alice)).filter((r) => r.provider === 'openrouter');
      expect(row?.encryptedKey).not.toContain(OR_A);
      expect(() =>
        decryptCredential(
          TEST_CREDENTIALS_KEY,
          row?.encryptedKey ?? '',
          credentialAad(alice.id, 'anthropic'),
        ),
      ).toThrow(CredentialUnreadableError);
    });

    it.each([
      ['rejected', 400, "OpenRouter didn't accept this key"],
      ['forbidden', 400, 'management key'],
      ['rate_limited', 503, 'rate limiting'],
      ['unreachable', 502, "Couldn't reach OpenRouter"],
    ] as const)(
      'refuses a key the check answers %s, saving nothing',
      async (result, status, text) => {
        const response = await saveOpenRouter(bob, OR_BAD, result);

        expect(response.statusCode).toBe(status);
        expect(response.json<{ message: string }>().message).toContain(text);
        expect(response.json<{ message: string }>().message).toContain('Nothing was saved.');
        expect(await rowsOf(bob)).toEqual([]);
      },
    );

    it('refuses a key in the wrong format before asking OpenRouter', async () => {
      const checksBefore = openRouterChecked.length;
      const response = await call('PUT', URL_OPENROUTER, bob, { apiKey: KEY_B });

      expect(response.statusCode).toBe(400);
      expect(response.body).toContain('should start with sk-or-');
      expect(openRouterChecked).toHaveLength(checksBefore);
      expect(await rowsOf(bob)).toEqual([]);
    });

    it("keeps each user's OpenRouter key apart", async () => {
      expect((await saveOpenRouter(bob, OR_B)).statusCode).toBe(200);
      expect(await getProviderKey(handle.db, TEST_CREDENTIALS_KEY, bob.id, 'openrouter')).toBe(
        OR_B,
      );
      expect(await getProviderKey(handle.db, TEST_CREDENTIALS_KEY, alice.id, 'openrouter')).toBe(
        OR_A,
      );
    });

    it('removes only the OpenRouter key', async () => {
      expect((await call('DELETE', URL_OPENROUTER, alice)).statusCode).toBe(204);
      expect((await rowsOf(alice)).map((row) => row.provider)).toEqual(['anthropic']);
      expect(await getProviderKey(handle.db, TEST_CREDENTIALS_KEY, bob.id, 'openrouter')).toBe(
        OR_B,
      );
      expect((await call('DELETE', URL_OPENROUTER, bob)).statusCode).toBe(204);
      expect(await rowsOf(bob)).toEqual([]);
    });

    it('answers 404 for a provider Stagehand does not store', async () => {
      expect(
        (await call('PUT', '/api/me/credentials/openai', bob, { apiKey: OR_B })).statusCode,
      ).toBe(404);
      expect((await call('DELETE', '/api/me/credentials/openai', bob)).statusCode).toBe(404);
    });
  });

  it("deletes a user's keys with the user", async () => {
    const carol = await signIn(app, discordUser({ id: '8003', global_name: 'Carol' }));
    const [carolRow] = await handle.db.select().from(users).where(eq(users.discordId, '8003'));
    const carolPerson = { cookie: carol, id: carolRow?.id ?? '' };
    expect((await save(carolPerson, KEY_B)).statusCode).toBe(200);

    await handle.db.delete(users).where(eq(users.id, carolPerson.id));

    expect(await rowsOf(carolPerson)).toEqual([]);
  });

  // Keep these two last: they scan everything the tests above produced.
  it('never sends a key or its ciphertext in any response', async () => {
    const stored = (await handle.db.select().from(providerCredentials)).map(
      (row) => row.encryptedKey,
    );
    const everything = responseBodies.join('\n');

    expect(responseBodies.length).toBeGreaterThan(20);
    for (const secret of [...ALL_KEYS, ...stored]) {
      expect(everything).not.toContain(secret);
      // Nor a recognisable chunk of one.
      expect(everything).not.toContain(secret.slice(13, 33));
    }
    // (`apiKey` itself may appear: validation errors name the field.)
    expect(everything).not.toMatch(/encryptedKey|encrypted_key/);
  });

  it('never writes a key or its ciphertext to the logs', async () => {
    const stored = (await handle.db.select().from(providerCredentials)).map(
      (row) => row.encryptedKey,
    );
    const everything = logLines.join('');

    // The logger really ran at trace level for these requests.
    expect(everything).toContain(URL_ANTHROPIC);
    for (const secret of [...ALL_KEYS, ...stored]) {
      expect(everything).not.toContain(secret);
      expect(everything).not.toContain(secret.slice(13, 33));
    }

    // And anything that does try to log a key field is redacted.
    const before = logLines.length;
    app.log.info(
      { apiKey: KEY_A, body: { apiKey: KEY_A }, headers: { authorization: `Bearer ${KEY_A}` } },
      'probe',
    );
    const probe = logLines.slice(before).join('');
    expect(probe).toContain('probe');
    expect(probe).toContain('[redacted]');
    expect(probe).not.toContain(KEY_A);
  });
});
