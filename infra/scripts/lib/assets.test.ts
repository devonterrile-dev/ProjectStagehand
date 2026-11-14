import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as tar from 'tar';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { compareAssets, readAssetsArchive } from './assets';

describe('readAssetsArchive', () => {
  let root: string;

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'stagehand-assets-'));
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('counts the files (not folders) and reads the top folder owner, as `tar -c -C /data .` writes it', async () => {
    const data = join(root, 'data');
    mkdirSync(join(data, 'campaigns', 'c1', 'processed'), { recursive: true });
    writeFileSync(join(data, 'campaigns', 'c1', 'a.png'), 'a');
    writeFileSync(join(data, 'campaigns', 'c1', 'b.png'), 'b');
    writeFileSync(join(data, 'campaigns', 'c1', 'processed', 'a.webp'), 'c');
    const file = join(root, 'assets.tar');
    await tar.create({ cwd: data, file }, ['.']);

    const contents = await readAssetsArchive(file);
    expect(contents.files).toBe(3);
    expect(contents.rootOwner).toMatch(/^\d+:\d+$/);
  });

  it('reads an empty volume as no files', async () => {
    const data = join(root, 'empty');
    mkdirSync(data);
    const file = join(root, 'empty.tar');
    await tar.create({ cwd: data, file }, ['.']);

    expect((await readAssetsArchive(file)).files).toBe(0);
  });
});

describe('compareAssets', () => {
  it('finds nothing when the files and the owner match', () => {
    expect(
      compareAssets({ files: 4, rootOwner: '1000:1000' }, { files: 4, rootOwner: '1000:1000' }),
    ).toEqual([]);
  });

  it('reports missing files and a top folder the app could not write to', () => {
    expect(
      compareAssets({ files: 4, rootOwner: '1000:1000' }, { files: 3, rootOwner: '0:0' }),
    ).toEqual([
      'assets volume: expected 4 files, found 3',
      'assets volume: top folder owned by 0:0, expected 1000:1000',
    ]);
  });

  it('skips the owner check when the archive had no top folder entry', () => {
    expect(compareAssets({ files: 1, rootOwner: null }, { files: 1, rootOwner: '0:0' })).toEqual(
      [],
    );
  });
});
