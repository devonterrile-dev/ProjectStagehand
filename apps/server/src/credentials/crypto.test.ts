import { describe, expect, it } from 'vitest';

import {
  credentialAad,
  CredentialUnreadableError,
  decryptCredential,
  encryptCredential,
} from './crypto';

const KEY = Buffer.alloc(32, 1);
const OTHER_KEY = Buffer.alloc(32, 2);
const SECRET = 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789-ABCD';
const AAD = credentialAad('user-a', 'anthropic');

/** Flips one bit of a base64url part of the stored value. */
function tamper(stored: string, partIndex: number): string {
  const parts = stored.split('.');
  const bytes = Buffer.from(parts[partIndex] ?? '', 'base64url');
  bytes[0] = (bytes[0] ?? 0) ^ 1;
  parts[partIndex] = bytes.toString('base64url');
  return parts.join('.');
}

describe('credential encryption', () => {
  it('round-trips a key', () => {
    const stored = encryptCredential(KEY, SECRET, AAD);

    expect(decryptCredential(KEY, stored, AAD)).toBe(SECRET);
  });

  it('stores a versioned value that does not contain the key', () => {
    const stored = encryptCredential(KEY, SECRET, AAD);

    expect(stored).toMatch(/^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{22}$/);
    expect(stored).not.toContain(SECRET);
    expect(stored).not.toContain(SECRET.slice(7, 30));
    expect(Buffer.from(stored.split('.')[2] ?? '', 'base64url').toString('utf8')).not.toContain(
      'sk-ant',
    );
  });

  it('uses a fresh IV every time', () => {
    const first = encryptCredential(KEY, SECRET, AAD);
    const second = encryptCredential(KEY, SECRET, AAD);

    expect(first).not.toBe(second);
    expect(first.split('.')[1]).not.toBe(second.split('.')[1]);
  });

  it('refuses a wrong master key', () => {
    const stored = encryptCredential(KEY, SECRET, AAD);

    expect(() => decryptCredential(OTHER_KEY, stored, AAD)).toThrow(CredentialUnreadableError);
  });

  it('refuses a value moved to another user or provider', () => {
    const stored = encryptCredential(KEY, SECRET, AAD);

    expect(() => decryptCredential(KEY, stored, credentialAad('user-b', 'anthropic'))).toThrow(
      CredentialUnreadableError,
    );
    expect(() => decryptCredential(KEY, stored, credentialAad('user-a', 'openrouter'))).toThrow(
      CredentialUnreadableError,
    );
  });

  it.each([
    ['IV', 1],
    ['ciphertext', 2],
    ['tag', 3],
  ])('refuses an altered %s', (_name, partIndex) => {
    const stored = encryptCredential(KEY, SECRET, AAD);

    expect(() => decryptCredential(KEY, tamper(stored, partIndex), AAD)).toThrow(
      CredentialUnreadableError,
    );
  });

  it.each([
    ['an unknown version', (stored: string) => stored.replace(/^v1/, 'v2')],
    ['a missing part', (stored: string) => stored.split('.').slice(0, 3).join('.')],
    ['an extra part', (stored: string) => `${stored}.AAAA`],
    ['non-base64url text', (stored: string) => stored.replace(/\.[^.]+$/, '.not+base64/')],
    ['a short tag', (stored: string) => stored.replace(/\.[^.]+$/, '.AAAA')],
    ['an empty string', () => ''],
  ])('refuses %s', (_name, mangle) => {
    const stored = encryptCredential(KEY, SECRET, AAD);

    expect(() => decryptCredential(KEY, mangle(stored), AAD)).toThrow(CredentialUnreadableError);
  });

  it('never puts the stored value in the error message', () => {
    const stored = encryptCredential(KEY, SECRET, AAD);
    let message = '';
    try {
      decryptCredential(OTHER_KEY, stored, AAD);
    } catch (error) {
      message = String(error);
    }

    expect(message).toBe('CredentialUnreadableError: Stored credential could not be decrypted');
  });

  it('insists on a 32-byte master key', () => {
    expect(() => encryptCredential(Buffer.alloc(16), SECRET, AAD)).toThrow(/32 bytes/);
  });
});
