/**
 * pnpm stack:restore <backup-file> --yes [--env infra/.env]
 *
 * Disaster recovery: REPLACES the production database and the generated images (the assets
 * volume) with the backup's, then starts the stack (which re-runs migrations). A backup taken
 * before there were images leaves the assets volume as it is. The backup's env file is written
 * to infra/.env.restored for comparison; infra/.env is never overwritten.
 *
 * Take a fresh backup first if the current data might matter (`pnpm stack:backup`).
 */
import { createReadStream } from 'node:fs';
import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { ASSETS, DATABASE_DUMP, ENV_FILE, extractEncryptedArchive } from './lib/archive';
import { restoreAssetsVolume } from './lib/assets';
import { summarise } from './lib/backup';
import { main, parseCommandArgs, step } from './lib/cli';
import { compose, dockerAvailable, postgresImage, runningServices } from './lib/docker';
import { backupSettings, fromInvocationDir, readEnvFile } from './lib/env';
import { compareCounts, inspectStackDatabase } from './lib/postgres';

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

main(async () => {
  const { values, positionals, envFile } = parseCommandArgs({
    yes: { type: 'boolean', default: false },
  });
  const file = positionals[0];
  if (!file) throw new Error('Usage: pnpm stack:restore <backup-file> --yes');
  if (values['yes'] !== true) {
    throw new Error('This replaces the production database. Re-run with --yes to confirm.');
  }

  const settings = backupSettings(readEnvFile(envFile).values);
  const { user, db } = settings.postgres;
  if (!IDENTIFIER.test(user) || !IDENTIFIER.test(db))
    throw new Error('Unexpected POSTGRES_USER/POSTGRES_DB value');
  if (!(await dockerAvailable())) throw new Error('Docker is not running');

  const backup = fromInvocationDir(file);
  const work = await mkdtemp(join(tmpdir(), 'stagehand-restore-'));
  try {
    step(`Decrypting and checking ${backup}`);
    const manifest = await extractEncryptedArchive(backup, settings.passphrase, work);
    step(`  Backup from ${manifest.createdAt}: ${summarise(manifest.tableCounts)}`);

    step('Starting the database and taking the site offline');
    await compose(envFile, ['up', '-d', '--wait', 'postgres']);
    const site = (await runningServices(envFile)).filter((service) => service !== 'postgres');
    if (site.length > 0) await compose(envFile, ['stop', ...site]);

    step(`Replacing database "${db}"`);
    const psql = (sql: string) =>
      compose(envFile, [
        'exec',
        '-T',
        'postgres',
        'psql',
        '-U',
        user,
        '-d',
        'postgres',
        '-v',
        'ON_ERROR_STOP=1',
        '-c',
        sql,
      ]);
    await psql(`drop database if exists "${db}" with (force)`);
    await psql(`create database "${db}" owner "${user}"`);
    await compose(
      envFile,
      [
        'exec',
        '-T',
        'postgres',
        'pg_restore',
        '--no-owner',
        '--exit-on-error',
        '-U',
        user,
        '-d',
        db,
      ],
      { stdin: createReadStream(join(work, DATABASE_DUMP)) },
    );

    const { counts } = await inspectStackDatabase(envFile, settings.postgres);
    const differences = compareCounts(manifest.tableCounts, counts);
    if (differences.length > 0)
      throw new Error(`Restored data does not match:\n  - ${differences.join('\n  - ')}`);
    step(`  Restored ${summarise(counts)}`);

    if (manifest.assets === 'included') {
      step('Replacing the generated images (assets volume)');
      const assets = await restoreAssetsVolume(
        envFile,
        await postgresImage(envFile),
        join(work, ASSETS),
      );
      step(`  Restored ${String(assets.files)} image files`);
    } else {
      step('The backup has no images; the assets volume is left as it is');
    }

    const restoredEnv = join(dirname(envFile), '.env.restored');
    await copyFile(join(work, ENV_FILE), restoredEnv);
    step(
      `Backup's settings written to ${restoredEnv} (compare with your env file; it was not changed)`,
    );

    step('Starting the stack (migrations run first)');
    await compose(envFile, ['up', '-d', '--build', '--wait']);
    step('Restore complete.');
  } finally {
    await rm(work, { recursive: true, force: true });
  }
});
