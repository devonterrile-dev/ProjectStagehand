/**
 * pnpm stack:restore-drill [backup-file] [--env infra/.env]
 *
 * Restore drill (governance §14): decrypts a backup (default: the newest), checks every
 * file's checksum, restores the database into a throwaway Postgres container and confirms
 * every table's row count matches the backup's manifest. Production is never touched; the
 * stack doesn't even need to be running, only Docker. Results go to restore-drill.log.
 */
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { DATABASE_DUMP, extractEncryptedArchive } from './lib/archive';
import { logDrill, summarise } from './lib/backup';
import { main, parseCommandArgs, step } from './lib/cli';
import { dockerAvailable } from './lib/docker';
import { backupSettings, fromInvocationDir, readEnvFile } from './lib/env';
import { compareCounts, restoreIntoThrowawayDatabase } from './lib/postgres';
import { sortBackups } from './lib/retention';

main(async () => {
  const { positionals, envFile } = parseCommandArgs({});
  const settings = backupSettings(readEnvFile(envFile).values);
  if (!(await dockerAvailable())) throw new Error('Docker is not running');

  const backup = positionals[0]
    ? fromInvocationDir(positionals[0])
    : await newestBackup(settings.backupDir);
  step(`Restore drill: ${backup}`);

  const work = await mkdtemp(join(tmpdir(), 'stagehand-drill-'));
  try {
    step('Decrypting and checking file checksums');
    const manifest = await extractEncryptedArchive(backup, settings.passphrase, work);

    step(`Restoring into a throwaway ${manifest.postgres.image} container`);
    const restored = await restoreIntoThrowawayDatabase(
      manifest.postgres.image,
      join(work, DATABASE_DUMP),
    );
    const differences = compareCounts(manifest.tableCounts, restored);
    if (differences.length > 0) {
      await logDrill(settings.backupDir, 'FAIL', backup, differences.join('; '), 'drill');
      throw new Error(
        `Restored data does not match the backup:\n  - ${differences.join('\n  - ')}`,
      );
    }
    await logDrill(settings.backupDir, 'PASS', backup, summarise(restored), 'drill');
    step(
      `PASS: ${summarise(restored)}, backup taken ${manifest.createdAt} (commit ${manifest.gitCommit ?? 'unknown'})`,
    );
  } catch (error) {
    if (!(error instanceof Error && error.message.startsWith('Restored data'))) {
      await logDrill(
        settings.backupDir,
        'FAIL',
        backup,
        error instanceof Error ? (error.message.split('\n')[0] ?? '') : String(error),
        'drill',
      ).catch(() => undefined);
    }
    throw error;
  } finally {
    await rm(work, { recursive: true, force: true });
  }
});

async function newestBackup(dir: string): Promise<string> {
  const [newest] = sortBackups(await readdir(dir).catch(() => []));
  if (!newest) throw new Error(`No backups found in ${dir}`);
  return join(dir, newest);
}
