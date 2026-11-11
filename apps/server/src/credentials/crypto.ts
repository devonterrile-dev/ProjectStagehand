/**
 * Encryption for GMs' provider API keys at rest (F1.7, governance §14, D-26).
 *
 * AES-256-GCM with the master key from CREDENTIALS_ENCRYPTION_KEY (32 random bytes, so no
 * key derivation). Stored as text:
 *
 *   v1.<IV, 12 bytes>.<ciphertext>.<GCM tag, 16 bytes>      (each part base64url)
 *
 * The associated data binds a ciphertext to its owner and provider, so a value copied onto
 * another user's row (or another provider's) fails to decrypt instead of handing out a key.
 * Pure functions: no I/O, nothing logged.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const VERSION = 'v1';
const IV_BYTES = 12;
const TAG_BYTES = 16;
export const MASTER_KEY_BYTES = 32;

/** The stored value can't be decrypted: wrong master key, altered, or not ours. */
export class CredentialUnreadableError extends Error {
  override name = 'CredentialUnreadableError';
  constructor() {
    // Never include the stored value or the key in the message.
    super('Stored credential could not be decrypted');
  }
}

/** Associated data for one user's key for one provider. */
export function credentialAad(userId: string, provider: string): string {
  return `stagehand:provider-credential:${VERSION}:${userId}:${provider}`;
}

function assertMasterKey(masterKey: Buffer): void {
  if (masterKey.length !== MASTER_KEY_BYTES) {
    throw new Error(`Credential master key must be ${String(MASTER_KEY_BYTES)} bytes`);
  }
}

export function encryptCredential(masterKey: Buffer, plaintext: string, aad: string): string {
  assertMasterKey(masterKey);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', masterKey, iv);
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv, ciphertext, tag]
    .map((part) => (typeof part === 'string' ? part : part.toString('base64url')))
    .join('.');
}

const PART = /^[A-Za-z0-9_-]*$/;

export function decryptCredential(masterKey: Buffer, stored: string, aad: string): string {
  assertMasterKey(masterKey);
  const parts = stored.split('.');
  if (parts.length !== 4 || parts[0] !== VERSION || !parts.every((part) => PART.test(part))) {
    throw new CredentialUnreadableError();
  }
  const [, ivText = '', ciphertextText = '', tagText = ''] = parts;
  const iv = Buffer.from(ivText, 'base64url');
  const ciphertext = Buffer.from(ciphertextText, 'base64url');
  const tag = Buffer.from(tagText, 'base64url');
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES || ciphertext.length === 0) {
    throw new CredentialUnreadableError();
  }

  try {
    const decipher = createDecipheriv('aes-256-gcm', masterKey, iv, { authTagLength: TAG_BYTES });
    decipher.setAAD(Buffer.from(aad, 'utf8'));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    throw new CredentialUnreadableError();
  }
}
