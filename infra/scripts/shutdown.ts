/**
 * pnpm stack:shutdown [--quit-docker] [--skip-backup] [--env infra/.env]
 *
 * The normal way to stop Stagehand (governance D-19): take the site offline, back up,
 * prove the backup restores, then stop the stack. Start again with `pnpm stack:up`.
 *
 * If the backup fails, the stack is NOT stopped: Postgres keeps running with all data, and
 * the error says what to do. `--skip-backup` stops without a backup (loudly).
 */
import { prepareBackup, runBackup } from './lib/backup';
import { main, parseCommandArgs, step, warn } from './lib/cli';
import { compose, dockerAvailable, run, runningServices } from './lib/docker';

main(async () => {
  const { values, envFile } = parseCommandArgs({
    'quit-docker': { type: 'boolean', default: false },
    'skip-backup': { type: 'boolean', default: false },
  });
  const skipBackup = values['skip-backup'] === true;
  const quitDocker = values['quit-docker'] === true;

  if (!(await dockerAvailable())) {
    step('Docker is not running, so there is nothing to shut down');
    return;
  }

  const running = await runningServices(envFile);
  if (!running.includes('postgres')) {
    step('The database is not running, so there is nothing new to back up');
  } else if (skipBackup) {
    warn(
      '--skip-backup: stopping WITHOUT a backup. Anything since the last backup is only in the Docker volume.',
    );
  } else {
    // Validate settings before touching anything, so a config mistake leaves the site up.
    const prepared = await prepareBackup(envFile);

    const site = running.filter((service) => service !== 'postgres');
    if (site.length > 0) {
      step(`Taking the site offline (stopping ${site.join(', ')})`);
      await compose(envFile, ['stop', ...site]);
    }

    try {
      const backup = await runBackup(envFile, prepared, 'shutdown');
      step(`Backup complete: ${backup}`);
    } catch (error) {
      throw new Error(
        `${error instanceof Error ? error.message : String(error)}\n\n` +
          'The stack was NOT stopped: the database is still running and nothing was lost.\n' +
          'The site is offline. Fix the problem and run `pnpm stack:shutdown` again, bring the\n' +
          'site back with `pnpm stack:up`, or stop without a backup: `pnpm stack:shutdown --skip-backup`.',
        { cause: error },
      );
    }
  }

  step('Stopping the stack (data volumes are kept)');
  await compose(envFile, ['down']);

  if (quitDocker) {
    step('Quitting Docker Desktop');
    const stopped = await run('docker', ['desktop', 'stop'], { allowFailure: true }).catch(
      () => null,
    );
    if (stopped?.code !== 0)
      warn('`docker desktop stop` failed; quit Docker Desktop from its tray icon.');
    if (process.platform === 'win32')
      await run('wsl', ['--shutdown'], { allowFailure: true }).catch(() => null);
  }

  step('Stagehand is shut down. Start it again with `pnpm stack:up`.');
});
