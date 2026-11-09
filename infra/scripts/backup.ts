/**
 * pnpm stack:backup [--env infra/.env]
 *
 * Verified, encrypted backup of the running stack, without stopping it (pg_dump takes a
 * consistent snapshot). For the everyday "back up and stop" use `pnpm stack:shutdown`.
 */
import { prepareBackup, runBackup } from './lib/backup';
import { main, parseCommandArgs, step } from './lib/cli';
import { dockerAvailable, runningServices } from './lib/docker';

main(async () => {
  const { envFile } = parseCommandArgs({});
  const prepared = await prepareBackup(envFile);

  if (!(await dockerAvailable())) throw new Error('Docker is not running');
  if (!(await runningServices(envFile)).includes('postgres')) {
    throw new Error('The stack is not running (start it with `pnpm stack:up`)');
  }

  const backup = await runBackup(envFile, prepared, 'backup');
  step(`Backup complete: ${backup}`);
});
