/**
 * Where generated images live (F2.3, governance §6 "local disk behind a storage interface",
 * D-42). Keys are names we generate (`campaigns/<campaignId>/<assetId>.png`), never anything
 * a user typed, so a key can't climb out of the root (§14). Moving to S3-compatible storage
 * later means another `AssetStorage`.
 */
import { createReadStream } from 'node:fs';
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import type { Readable } from 'node:stream';

export interface AssetStorage {
  /** Stores the bytes under `key`, replacing anything there. */
  put(key: string, data: Buffer): Promise<void>;
  /** The stored bytes as a stream, or null if there is nothing under `key`. */
  open(key: string): Promise<Readable | null>;
  /** Removes `key`; nothing happens if it isn't there. */
  remove(key: string): Promise<void>;
}

const KEY = /^[a-z0-9-]+(\/[a-z0-9-]+)*\.[a-z0-9]+$/;

/** The storage key of an asset's untouched original. */
export function originalKey(campaignId: string, assetId: string, extension: string): string {
  return `campaigns/${campaignId}/${assetId}.${extension}`;
}

/** The file extension for an image media type. */
export function extensionOf(mediaType: string): string {
  if (mediaType === 'image/webp') return 'webp';
  if (mediaType === 'image/jpeg') return 'jpg';
  return 'png';
}

/** Files under `root`, which is created on first write. */
export function createDiskStorage(root: string): AssetStorage {
  const base = resolve(root);

  function pathOf(key: string): string {
    if (!KEY.test(key)) throw new Error('invalid asset storage key');
    const path = join(base, key);
    const inside = relative(base, path);
    if (inside.startsWith('..') || isAbsolute(inside)) throw new Error('invalid asset storage key');
    return path;
  }

  return {
    async put(key, data) {
      const path = pathOf(key);
      await mkdir(dirname(path), { recursive: true });
      // Written whole then renamed would be safer against a crash mid-write, but an asset
      // only points at its file once the write has finished, so a torn file is never served.
      await writeFile(path, data);
    },
    async open(key) {
      const path = pathOf(key);
      try {
        const info = await stat(path);
        if (!info.isFile()) return null;
      } catch {
        return null;
      }
      return createReadStream(path);
    },
    async remove(key) {
      await rm(pathOf(key), { force: true });
    },
  };
}
