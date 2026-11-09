import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  DATABASE_DUMP,
  ENV_FILE,
  extractEncryptedArchive,
  FORMAT_VERSION,
  MANIFEST,
  sha256File,
  writeEncryptedArchive,
  type Manifest,
} from './archive';
import { BackupDecryptionError } from './crypto';

const PASSPHRASE = 'archive-test-passphrase';

describe('encrypted archive', () => {
  let root: string;
  let staging: string;
  let backup: string;

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'stagehand-archive-'));
    staging = join(root, 'staging');
    mkdirSync(staging);
    writeFileSync(join(staging, DATABASE_DUMP), Buffer.from('PGDMP fake dump bytes'));
    writeFileSync(join(staging, ENV_FILE), 'POSTGRES_PASSWORD=secret\n');
    const manifest: Manifest = {
      format: FORMAT_VERSION,
      createdAt: '2026-11-09T01:30:05.000Z',
      gitCommit: 'abc1234',
      postgres: { serverVersion: '18.6', image: 'postgres:18.6-trixie' },
      tableCounts: { 'public.users': 1 },
      files: {
        [DATABASE_DUMP]: await sha256File(join(staging, DATABASE_DUMP)),
        [ENV_FILE]: await sha256File(join(staging, ENV_FILE)),
      },
      assets: 'none',
    };
    writeFileSync(join(staging, MANIFEST), JSON.stringify(manifest));
    backup = join(root, 'stagehand-20261109-013005Z.stbak');
    await writeEncryptedArchive(staging, [DATABASE_DUMP, ENV_FILE], backup, PASSPHRASE);
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('writes one file and leaves no .partial behind', () => {
    expect(readdirSync(root).filter((name) => name.endsWith('.partial'))).toEqual([]);
    expect(readFileSync(backup).includes(Buffer.from('POSTGRES_PASSWORD'))).toBe(false);
  });

  it('extracts and verifies every file against the manifest', async () => {
    const out = join(root, 'out');
    const manifest = await extractEncryptedArchive(backup, PASSPHRASE, out);

    expect(manifest.tableCounts).toEqual({ 'public.users': 1 });
    expect(readFileSync(join(out, ENV_FILE), 'utf8')).toBe('POSTGRES_PASSWORD=secret\n');
    expect(readFileSync(join(out, DATABASE_DUMP), 'utf8')).toBe('PGDMP fake dump bytes');
  });

  it('refuses the wrong passphrase without writing any extracted files', async () => {
    const out = join(root, 'wrong');
    await expect(extractEncryptedArchive(backup, 'wrong-passphrase', out)).rejects.toBeInstanceOf(
      BackupDecryptionError,
    );
    expect(readdirSync(out)).toEqual([]);
  });
});
