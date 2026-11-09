import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createWriteStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  BackupDecryptionError,
  createEncryptStream,
  HEADER_BYTES,
  MAGIC,
  openDecryptStream,
} from './crypto';

const PASSPHRASE = 'correct horse battery staple';

async function encryptToFile(data: Buffer, path: string, passphrase = PASSPHRASE) {
  // Feed it in uneven chunks to exercise streaming.
  const chunks = [data.subarray(0, 7), data.subarray(7, 70_000), data.subarray(70_000)];
  await pipeline(
    Readable.from(chunks),
    await createEncryptStream(passphrase),
    createWriteStream(path),
  );
}

async function decryptFile(path: string, passphrase = PASSPHRASE): Promise<Buffer> {
  const parts: Buffer[] = [];
  for await (const chunk of await openDecryptStream(path, passphrase)) parts.push(chunk as Buffer);
  return Buffer.concat(parts);
}

describe('backup encryption', () => {
  let dir: string;
  const data = randomBytes(200_000);

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'stagehand-crypto-'));
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('round-trips data through the file format', async () => {
    const path = join(dir, 'roundtrip.stbak');
    await encryptToFile(data, path);

    const file = readFileSync(path);
    expect(file.subarray(0, MAGIC.length).toString('ascii')).toBe('STGHBAK1');
    expect(file.length).toBe(HEADER_BYTES + data.length + 16);
    expect(file.includes(data.subarray(0, 64))).toBe(false); // not stored in the clear
    expect((await decryptFile(path)).equals(data)).toBe(true);
  });

  it('round-trips empty input', async () => {
    const path = join(dir, 'empty.stbak');
    await encryptToFile(Buffer.alloc(0), path);

    expect((await decryptFile(path)).length).toBe(0);
  });

  it('uses a fresh salt and IV every time', async () => {
    const a = join(dir, 'a.stbak');
    const b = join(dir, 'b.stbak');
    await encryptToFile(data, a);
    await encryptToFile(data, b);

    expect(
      readFileSync(a).subarray(0, HEADER_BYTES).equals(readFileSync(b).subarray(0, HEADER_BYTES)),
    ).toBe(false);
  });

  it('rejects the wrong passphrase', async () => {
    const path = join(dir, 'wrong.stbak');
    await encryptToFile(data, path);

    await expect(decryptFile(path, 'not the passphrase')).rejects.toBeInstanceOf(
      BackupDecryptionError,
    );
  });

  it('detects a single flipped byte anywhere in the ciphertext', async () => {
    const path = join(dir, 'tampered.stbak');
    await encryptToFile(data, path);
    const file = readFileSync(path);
    file[HEADER_BYTES + 12_345] = (file[HEADER_BYTES + 12_345] ?? 0) ^ 0x01;
    writeFileSync(path, file);

    await expect(decryptFile(path)).rejects.toBeInstanceOf(BackupDecryptionError);
  });

  it('detects truncation', async () => {
    const path = join(dir, 'truncated.stbak');
    await encryptToFile(data, path);
    writeFileSync(path, readFileSync(path).subarray(0, -100));

    await expect(decryptFile(path)).rejects.toBeInstanceOf(BackupDecryptionError);
  });

  it('rejects files that are not backups', async () => {
    const path = join(dir, 'not-a-backup.stbak');
    writeFileSync(path, Buffer.concat([Buffer.from('PK\x03\x04'), randomBytes(100)]));

    await expect(decryptFile(path)).rejects.toThrow(/not a Stagehand backup/);
  });
});
