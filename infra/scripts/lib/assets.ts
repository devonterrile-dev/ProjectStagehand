/**
 * The generated-images volume (`<project>_assets`, F2.3, D-42) in backups: archived by
 * `stack:backup`/`stack:shutdown`, unpacked again by `stack:restore`, and checked by the
 * restore drill in a throwaway volume. Every step runs `tar` in the postgres image, which the
 * stack already has, so restoring needs nothing but Docker.
 */
import { createReadStream, createWriteStream } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { finished } from 'node:stream/promises';

import * as tar from 'tar';

import { compose, projectName, run } from './docker';

/** What a volume (or an archive of one) holds: its files and who owns its top folder. */
export interface AssetsContents {
  files: number;
  /** `uid:gid` of the volume's top folder. The app runs as `node` and must be able to write. */
  rootOwner: string | null;
}

/** The stack's assets volume, e.g. `stagehand_assets`. */
export async function assetsVolumeName(envFile: string): Promise<string> {
  return `${await projectName(envFile)}_assets`;
}

async function volumeExists(volume: string): Promise<boolean> {
  const result = await run('docker', ['volume', 'inspect', volume], { allowFailure: true });
  return result.code === 0;
}

/** Tars the stack's assets volume, if it exists, into `outPath`. False when there is none yet. */
export async function archiveAssetsVolume(
  envFile: string,
  image: string,
  outPath: string,
): Promise<boolean> {
  const volume = await assetsVolumeName(envFile);
  if (!(await volumeExists(volume))) return false;

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
      { stdout: out },
    );
  } finally {
    out.end();
    await finished(out);
  }
  return true;
}

/** What an assets archive (as `archiveAssetsVolume` wrote it) holds. */
export async function readAssetsArchive(tarPath: string): Promise<AssetsContents> {
  let files = 0;
  let rootOwner: string | null = null;
  await tar.list({
    file: tarPath,
    onReadEntry: (entry) => {
      if (entry.type === 'File') files += 1;
      if (entry.path === './' || entry.path === '.') {
        rootOwner = `${String(entry.uid ?? 0)}:${String(entry.gid ?? 0)}`;
      }
    },
  });
  return { files, rootOwner };
}

/** Empties `volume` and unpacks the archive into it, keeping each file's owner. */
async function unpackIntoVolume(volume: string, image: string, tarPath: string): Promise<void> {
  await run(
    'docker',
    [
      'run',
      '--rm',
      '-i',
      '-v',
      `${volume}:/data`,
      '--entrypoint',
      'sh',
      image,
      '-c',
      // Runs as root, so tar restores the recorded owners (`node`, uid 1000 in the app image).
      'find /data -mindepth 1 -delete && tar --numeric-owner -x -C /data',
    ],
    { stdin: createReadStream(tarPath) },
  );
}

async function inspectVolume(volume: string, image: string): Promise<AssetsContents> {
  const { stdout } = await run('docker', [
    'run',
    '--rm',
    '-v',
    `${volume}:/data:ro`,
    '--entrypoint',
    'sh',
    image,
    '-c',
    'find /data -type f | wc -l; stat -c %u:%g /data',
  ]);
  const [files = '', rootOwner = ''] = stdout.trim().split(/\r?\n/);
  return { files: Number(files.trim()), rootOwner: rootOwner.trim() || null };
}

/** Differences between what an archive held and what a volume holds now; empty when they match. */
export function compareAssets(expected: AssetsContents, actual: AssetsContents): string[] {
  const differences: string[] = [];
  if (expected.files !== actual.files) {
    differences.push(
      `assets volume: expected ${String(expected.files)} files, found ${String(actual.files)}`,
    );
  }
  if (expected.rootOwner !== null && expected.rootOwner !== actual.rootOwner) {
    differences.push(
      `assets volume: top folder owned by ${actual.rootOwner ?? 'nobody'}, expected ${expected.rootOwner}`,
    );
  }
  return differences;
}

/**
 * Replaces the stack's assets volume with the archive's contents and checks the result. A
 * missing volume is made by Compose (`create app`), so it carries Compose's own labels.
 */
export async function restoreAssetsVolume(
  envFile: string,
  image: string,
  tarPath: string,
): Promise<AssetsContents> {
  const expected = await readAssetsArchive(tarPath);
  const volume = await assetsVolumeName(envFile);
  if (!(await volumeExists(volume))) {
    await compose(envFile, ['create', '--build', '--no-recreate', 'app']);
  }
  await unpackIntoVolume(volume, image, tarPath);
  const restored = await inspectVolume(volume, image);
  const differences = compareAssets(expected, restored);
  if (differences.length > 0) {
    throw new Error(`Restored assets do not match:\n  - ${differences.join('\n  - ')}`);
  }
  return restored;
}

/**
 * Unpacks the archive into a throwaway volume (removed afterwards) and returns what landed
 * there: the restore drill's proof that the images come back.
 */
export async function restoreIntoThrowawayVolume(
  image: string,
  tarPath: string,
): Promise<AssetsContents> {
  const volume = `stagehand-drill-assets-${randomBytes(4).toString('hex')}`;
  await run('docker', ['volume', 'create', volume]);
  try {
    await unpackIntoVolume(volume, image, tarPath);
    return await inspectVolume(volume, image);
  } finally {
    await run('docker', ['volume', 'rm', '-f', volume], { allowFailure: true });
  }
}
