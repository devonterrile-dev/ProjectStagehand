import { appendFile, mkdir, readdir, rm, unlink, writeFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { basename, join } from 'node:path';
import { finished } from 'node:stream/promises';

import {
  ASSETS,
  DATABASE_DUMP,
  ENV_FILE,
  extractEncryptedArchive,
  FORMAT_VERSION,
  MANIFEST,
  sha256File,
  writeEncryptedArchive,
  type Manifest,
} from './archive';
import { postgresImage, projectName, REPO_ROOT, run } from './docker';
import { backupSettings, envForBackup, readEnvFile, type BackupSettings } from './env';
import {
  compareCounts,
  dumpStackDatabase,
  inspectStackDatabase,
  restoreIntoThrowawayDatabase,
  type TableCounts,
} from './postgres';
import { backupFileName, backupsToPrune } from './retention';
import { step } from './cli';

export const DRILL_LOG = 'restore-drill.log';

/** Reads and validates settings, and checks BACKUP_DIR is writable. Throws before any side effects. */
export async function prepareBackup(
  envFile: string,
): Promise<{ settings: BackupSettings; envRaw: string }> {
  const { raw, values } = readEnvFile(envFile);
  const settings = backupSettings(values);
  await mkdir(settings.backupDir, { recursive: true });
  const probe = join(settings.backupDir, `.write-test-${String(process.pid)}`);
  try {
    await writeFile(probe, 'ok');
    await unlink(probe);
  } catch {
    throw new Error(`BACKUP_DIR ${settings.backupDir} is not writable`);
  }
  return { settings, envRaw: raw };
}

export async function logDrill(
  backupDir: string,
  outcome: 'PASS' | 'FAIL',
  backup: string,
  detail: string,
  context: string,
): Promise<void> {
  const line = `${new Date().toISOString()} ${outcome} ${basename(backup)} [${context}] ${detail}\n`;
  await appendFile(join(backupDir, DRILL_LOG), line);
}

export function summarise(counts: TableCounts): string {
  const rows = Object.values(counts).reduce((sum, n) => sum + n, 0);
  return `${String(Object.keys(counts).length)} tables, ${String(rows)} rows`;
}

/**
 * Takes a verified, encrypted backup of the running stack. Returns the backup file path.
 *
 * Order matters: the dump is proven restorable *before* it is packaged, and the packaged
 * file is decrypted and checked again *before* old backups are pruned. Anything failing
 * throws, leaving earlier backups untouched and no partial files behind.
 */
export async function runBackup(
  envFile: string,
  prepared: { settings: BackupSettings; envRaw: string },
  context: string,
): Promise<string> {
  const { settings, envRaw } = prepared;
  const createdAt = new Date();
  const outPath = join(settings.backupDir, backupFileName(createdAt));
  const staging = join(settings.backupDir, `.staging-${String(createdAt.getTime())}`);
  await mkdir(staging, { recursive: true });

  try {
    const image = await postgresImage(envFile);

    step('Reading table counts');
    const { counts, serverVersion } = await inspectStackDatabase(envFile, settings.postgres);
    step(`  ${summarise(counts)} (PostgreSQL ${serverVersion})`);

    step('Dumping the database');
    const dumpPath = join(staging, DATABASE_DUMP);
    await dumpStackDatabase(envFile, settings.postgres, dumpPath);

    step('Verifying the dump by restoring it into a throwaway database');
    const restored = await restoreIntoThrowawayDatabase(image, dumpPath);
    const differences = compareCounts(counts, restored);
    if (differences.length > 0) {
      await logDrill(settings.backupDir, 'FAIL', outPath, differences.join('; '), context);
      throw new Error(`The dump did not restore identically:\n  - ${differences.join('\n  - ')}`);
    }
    await logDrill(settings.backupDir, 'PASS', outPath, summarise(restored), context);
    step('  Restore check passed');

    await writeFile(join(staging, ENV_FILE), envForBackup(envRaw));
    const files = [DATABASE_DUMP, ENV_FILE];

    const assetsIncluded = await archiveAssetsVolume(envFile, image, join(staging, ASSETS));
    if (assetsIncluded) files.push(ASSETS);
    step(
      assetsIncluded ? 'Included the assets volume' : 'No assets volume yet (Phase 2); skipping',
    );

    const manifest: Manifest = {
      format: FORMAT_VERSION,
      createdAt: createdAt.toISOString(),
      gitCommit: await gitCommit(),
      postgres: { serverVersion, image },
      tableCounts: counts,
      files: Object.fromEntries(
        await Promise.all(
          files.map(async (name) => [name, await sha256File(join(staging, name))] as const),
        ),
      ),
      assets: assetsIncluded ? 'included' : 'none',
    };
    await writeFile(join(staging, MANIFEST), JSON.stringify(manifest, null, 2));

    step('Encrypting');
    await writeEncryptedArchive(staging, files, outPath, settings.passphrase);

    step('Checking the encrypted file decrypts and matches');
    await extractEncryptedArchive(outPath, settings.passphrase, join(staging, 'check'));

    await pruneOldBackups(settings);
    return outPath;
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

async function pruneOldBackups(settings: BackupSettings): Promise<void> {
  const prune = backupsToPrune(await readdir(settings.backupDir), settings.keep);
  for (const name of prune) await unlink(join(settings.backupDir, name));
  if (prune.length > 0)
    step(
      `Removed ${String(prune.length)} old backup(s), keeping the newest ${String(settings.keep)}`,
    );
}

/** Tars the `<project>_assets` volume, if it exists, using the postgres image (it has tar). */
async function archiveAssetsVolume(
  envFile: string,
  image: string,
  outPath: string,
): Promise<boolean> {
  const volume = `${await projectName(envFile)}_assets`;
  const exists = await run('docker', ['volume', 'inspect', volume], { allowFailure: true });
  if (exists.code !== 0) return false;

  const out = createWriteStream(outPath);
  try {
    await run(
      'docker',
      [
        'run',
        '--rm',
        '-v',
        `${volume}:/data:ro`,
        '--entrypoint',
        'tar',
        image,
        '-c',
        '-C',
        '/data',
        '.',
      ],
      {
        stdout: out,
      },
    );
  } finally {
    out.end();
    await finished(out);
  }
  return true;
}

async function gitCommit(): Promise<string | null> {
  const result = await run('git', ['-C', REPO_ROOT, 'rev-parse', '--short', 'HEAD'], {
    allowFailure: true,
  }).catch(() => null);
  return result?.code === 0 ? result.stdout.trim() : null;
}
