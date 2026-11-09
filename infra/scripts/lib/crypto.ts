/**
 * Backup encryption: AES-256-GCM with a key derived from a passphrase by scrypt.
 *
 * File format (version 1), documented in the README so it can be decrypted without this code:
 *
 *   magic "STGHBAK1" (8) | scrypt salt (16) | GCM IV (12) | ciphertext (...) | GCM tag (16)
 *
 *   key = scrypt(passphrase, salt, N=2^17, r=8, p=1, keylen=32)
 *
 * GCM authenticates the whole ciphertext, but only once the last byte is read: anything
 * decrypted before the stream finishes without error must be treated as untrusted. The
 * callers decrypt to a temporary location and use it only after success.
 */
import { createCipheriv, createDecipheriv, randomBytes, scrypt } from 'node:crypto';
import { open, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { Readable, Transform } from 'node:stream';

export const MAGIC = Buffer.from('STGHBAK1', 'ascii');
const SALT_BYTES = 16;
const IV_BYTES = 12;
const TAG_BYTES = 16;
export const HEADER_BYTES = MAGIC.length + SALT_BYTES + IV_BYTES;

const SCRYPT = { N: 2 ** 17, r: 8, p: 1, maxmem: 256 * 1024 * 1024 } as const;

export class BackupDecryptionError extends Error {
  override name = 'BackupDecryptionError';
}

function deriveKey(passphrase: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(passphrase, salt, 32, SCRYPT, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

/** A Transform that turns plaintext into a complete encrypted backup file (header and tag included). */
export async function createEncryptStream(passphrase: string): Promise<Transform> {
  const salt = randomBytes(SALT_BYTES);
  const iv = randomBytes(IV_BYTES);
  const key = await deriveKey(passphrase, salt);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  let headerSent = false;

  const sendHeader = (stream: Transform) => {
    if (headerSent) return;
    headerSent = true;
    stream.push(Buffer.concat([MAGIC, salt, iv]));
  };

  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      sendHeader(this);
      callback(null, cipher.update(chunk));
    },
    flush(callback) {
      sendHeader(this);
      this.push(cipher.final());
      callback(null, cipher.getAuthTag());
    },
  });
}

/**
 * Opens an encrypted backup file and returns its decrypted contents as a stream. The stream
 * errors with BackupDecryptionError if the passphrase is wrong or the file was altered.
 */
export async function openDecryptStream(path: string, passphrase: string): Promise<Readable> {
  const { size } = await stat(path);
  if (size < HEADER_BYTES + TAG_BYTES) {
    throw new BackupDecryptionError(`${path} is too small to be a Stagehand backup`);
  }

  const handle = await open(path, 'r');
  const header = Buffer.alloc(HEADER_BYTES);
  const tag = Buffer.alloc(TAG_BYTES);
  try {
    await handle.read(header, 0, HEADER_BYTES, 0);
    await handle.read(tag, 0, TAG_BYTES, size - TAG_BYTES);
  } finally {
    await handle.close();
  }

  if (!header.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new BackupDecryptionError(`${path} is not a Stagehand backup (bad magic)`);
  }
  const salt = header.subarray(MAGIC.length, MAGIC.length + SALT_BYTES);
  const iv = header.subarray(MAGIC.length + SALT_BYTES);
  const key = await deriveKey(passphrase, salt);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);

  const ciphertextBytes = size - HEADER_BYTES - TAG_BYTES;
  // createReadStream can't express an empty range (start > end), so special-case it.
  const ciphertext =
    ciphertextBytes === 0
      ? Readable.from([])
      : createReadStream(path, { start: HEADER_BYTES, end: size - TAG_BYTES - 1 });
  const plaintext = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      callback(null, decipher.update(chunk));
    },
    flush(callback) {
      try {
        callback(null, decipher.final());
      } catch {
        callback(
          new BackupDecryptionError(
            'Backup could not be decrypted: wrong passphrase, or the file is damaged or was modified',
          ),
        );
      }
    },
  });

  ciphertext.on('error', (error: Error) => plaintext.destroy(error));
  return ciphertext.pipe(plaintext);
}
