import { describe, expect, it } from 'vitest';

import {
  anthropicApiKeySchema,
  providerCredentialSchema,
  providerCredentialsResponseSchema,
  saveAnthropicKeyRequestSchema,
} from './provider-credentials';

const KEY = 'sk-ant-api03-AbCdEfGhIjKlMnOpQrStUvWxYz_0123456789-wxyz';

function messagesFor(input: unknown): string[] {
  const result = anthropicApiKeySchema.safeParse(input);
  return result.success ? [] : result.error.issues.map((issue) => issue.message);
}

describe('anthropicApiKeySchema', () => {
  it('accepts a regular key and trims pasted whitespace', () => {
    expect(anthropicApiKeySchema.parse(`  ${KEY}\n`)).toBe(KEY);
  });

  it('rejects empty input', () => {
    expect(messagesFor('   ')).toEqual(['Paste your Anthropic API key']);
  });

  it('rejects keys from other providers and malformed keys', () => {
    for (const input of ['sk-proj-abcdefghijklmnopqrstuvwxyz', 'sk-ant-short', `${KEY} extra`]) {
      expect(messagesFor(input)).toEqual([
        "That doesn't look like an Anthropic API key. It should start with sk-ant-",
      ]);
    }
  });

  it('refuses Admin API keys with their own message', () => {
    expect(messagesFor('sk-ant-admin01-abcdefghijklmnopqrstuvwxyz0123')).toEqual([
      "That's an Admin API key. Use a regular API key from the Anthropic Console",
    ]);
  });

  it('rejects overly long input', () => {
    expect(messagesFor(`sk-ant-${'a'.repeat(300)}`)).toContain(
      'That is too long to be an Anthropic API key',
    );
  });

  it('never repeats the input in an error', () => {
    const bad = 'sk-ant-admin01-SECRETSECRETSECRETSECRET';
    const result = saveAnthropicKeyRequestSchema.safeParse({ apiKey: bad });

    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).not.toContain('SECRETSECRET');
  });
});

describe('saveAnthropicKeyRequestSchema', () => {
  it('rejects unknown fields', () => {
    expect(saveAnthropicKeyRequestSchema.safeParse({ apiKey: KEY, provider: 'x' }).success).toBe(
      false,
    );
  });
});

describe('providerCredentialSchema', () => {
  it('strips anything but the provider, last four and date', () => {
    const parsed = providerCredentialsResponseSchema.parse({
      credentials: [
        {
          provider: 'anthropic',
          lastFour: 'wxyz',
          createdAt: '2026-11-11T10:00:00.000Z',
          apiKey: KEY,
          encryptedKey: 'v1.aaa.bbb.ccc',
        },
      ],
    });

    expect(parsed).toEqual({
      credentials: [
        { provider: 'anthropic', lastFour: 'wxyz', createdAt: '2026-11-11T10:00:00.000Z' },
      ],
    });
    expect(JSON.stringify(parsed)).not.toContain('sk-ant');
  });

  it('insists on exactly four characters', () => {
    const base = { provider: 'anthropic', createdAt: '2026-11-11T10:00:00.000Z' };
    expect(providerCredentialSchema.safeParse({ ...base, lastFour: 'abc' }).success).toBe(false);
    expect(providerCredentialSchema.safeParse({ ...base, lastFour: 'abcde' }).success).toBe(false);
  });
});
