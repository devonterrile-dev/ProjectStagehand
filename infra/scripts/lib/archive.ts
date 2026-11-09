import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';

import * as tar from 'tar';

import { createEncryptStream, openDecryptStream } from './crypto';
import type { TableCounts } from './postgres';

export const FORMAT_VERSION = 1;
export const MANIFEST = 'manifest.json';
export const DATABASE_DUMP = 'database.dump';
export const ENV_FILE = 'infra.env';
export const ASSETS = 'assets.tar';

export interface Manifest {
  /** Checked on read: a newer tool's backup must be refused, not misread. */
  format: number;
  createdAt: string;
  gitCommit: string | null;
  postgres: { serverVersion: string; image: string };
  /** Row counts at backup time; a restore must reproduce them exactly. */
  tableCounts: TableCounts;
  /** sha256 of every other file in the archive. */
  files: Record<string, string>;
  assets: 'included' | 'none';
}

export async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256');
  await pipeline(createReadStream(path), hash);
  return hash.digest('hex');
}

/**
 * Packs the files in `stagingDir` (manifest first) into an encrypted backup at `outPath`.
 * Writes to `<outPath>.partial` and renames only on success, so a half-written backup never
 * looks like a real one.
 */
export async function writeEncryptedArchive(
  stagingDir: string,
  fileNames: string[],
  outPath: string,
  passphrase: string,
): Promise<void> {
  const partial = `${outPath}.partial`;
  try {
    await pipeline(
      tar.create({ cwd: stagingDir, portable: true, noMtime: false }, [MANIFEST, ...fileNames]),
      await createEncryptStream(passphrase),
      createWriteStream(partial),
    );
    await rename(partial, outPath);
  } catch (error) {
    await rm(partial, { force: true });
    throw error;
  }
}

/**
 * Decrypts and unpacks a backup into `outDir`, then checks every file against the manifest's
 * sha256. Returns the manifest. Throws on a wrong passphrase, tampering or a mismatch.
 */
export async function extractEncryptedArchive(
  backupPath: string,
  passphrase: string,
  outDir: string,
): Promise<Manifest> {
  await mkdir(outDir, { recursive: true });

  // Decrypt completely before unpacking anything. GCM only authenticates at the very end, so
  // streaming straight into tar could write unauthenticated (attacker-controlled or garbage)
  // files to disk before the passphrase or tampering check fails.
  const decryptedTar = join(outDir, '.archive.tar');
  try {
    await pipeline(
      await openDecryptStream(backupPath, passphrase),
      createWriteStream(decryptedTar),
    );
    await tar.extract({ cwd: outDir, file: decryptedTar, strict: true });
  } finally {
    await rm(decryptedTar, { force: true });
  }

  const manifest = JSON.parse(await readFile(join(outDir, MANIFEST), 'utf8')) as Manifest;
  if (manifest.format !== FORMAT_VERSION) {
    throw new Error(
      `Unsupported backup format ${String(manifest.format)} (this tool reads ${String(FORMAT_VERSION)})`,
    );
  }
  for (const [name, expected] of Object.entries(manifest.files)) {
    const actual = await sha256File(join(outDir, name));
    if (actual !== expected) throw new Error(`${name} in the backup does not match its checksum`);
  }
  return manifest;
}
