import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Readable } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { createDiskStorage, extensionOf, originalKey, processedKey } from './storage';

async function bytesOf(stream: Readable | null): Promise<Buffer | null> {
  if (stream === null) return null;
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

describe('disk asset storage', () => {
  const storage = createDiskStorage(join(mkdtempSync(join(tmpdir(), 'stagehand-store-')), 'a'));
  const key = originalKey(
    '0b6c2a4e-1f00-4c2b-9d7e-111111111111',
    '5d0e7c1a-2b00-4f3c-8e9a-222222222222',
    'png',
  );

  it('stores, reads and removes a file, creating its folders', async () => {
    await storage.put(key, Buffer.from('image'));
    expect(await bytesOf(await storage.open(key))).toEqual(Buffer.from('image'));
    expect(await storage.read(key)).toEqual(Buffer.from('image'));
    await storage.remove(key);
    expect(await storage.open(key)).toBeNull();
    expect(await storage.read(key)).toBeNull();
    await storage.remove(key);
  });

  it('answers null for a key with nothing stored', async () => {
    expect(await storage.open('campaigns/none/missing.png')).toBeNull();
  });

  it('refuses a key that is not one of ours', async () => {
    for (const bad of [
      '../escape.png',
      'campaigns/../../x.png',
      '/abs.png',
      'UPPER.png',
      'a b.png',
    ]) {
      await expect(storage.put(bad, Buffer.from('x')), bad).rejects.toThrow('invalid');
    }
  });

  it('keeps processed images in their own folder, under a key it accepts', async () => {
    const processed = processedKey(
      '0b6c2a4e-1f00-4c2b-9d7e-111111111111',
      '5d0e7c1a-2b00-4f3c-8e9a-222222222222',
    );
    expect(processed).toBe(
      'campaigns/0b6c2a4e-1f00-4c2b-9d7e-111111111111/processed/5d0e7c1a-2b00-4f3c-8e9a-222222222222.webp',
    );
    await storage.put(processed, Buffer.from('webp'));
    expect(await storage.read(processed)).toEqual(Buffer.from('webp'));
  });

  it('names files by media type', () => {
    expect(extensionOf('image/png')).toBe('png');
    expect(extensionOf('image/webp')).toBe('webp');
    expect(extensionOf('image/jpeg')).toBe('jpg');
  });
});
