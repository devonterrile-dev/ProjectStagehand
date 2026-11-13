import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ASSET_KINDS } from '@stagehand/shared';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import {
  anchorKindOf,
  anchorMediaType,
  anchorsFor,
  ANCHORS_PER_KIND_MAX,
  buildImagePrompt,
  colorDistance,
  DEFAULT_STYLE_BIBLE_DIR,
  FORBIDDEN_STYLE_WORDS,
  KEY_COLOR_MIN_DISTANCE,
  loadStyleBible,
  STYLE_BIBLE_VERSION,
  StyleBibleError,
  styleBibleDir,
  subjectLines,
} from './index';

const temp = mkdtempSync(join(tmpdir(), 'stagehand-style-bible-'));
afterAll(() => {
  rmSync(temp, { recursive: true, force: true });
});

/** A fresh copy of the shipped version, as v1 under `temp`, to break one file at a time. */
function copyOfV1(): string {
  const dir = mkdtempSync(join(temp, 'copy-'));
  cpSync(styleBibleDir(STYLE_BIBLE_VERSION), styleBibleDir(1, dir), { recursive: true });
  return dir;
}

interface PaletteJson {
  colors: { hex: string }[];
}
interface StyleJson {
  version: number;
  anchors: unknown[];
}

function readJson(dir: string, file: string): unknown {
  return JSON.parse(readFileSync(join(styleBibleDir(1, dir), file), 'utf8'));
}

function writeJson(dir: string, file: string, value: unknown) {
  writeFileSync(join(styleBibleDir(1, dir), file), JSON.stringify(value));
}

function editPalette(dir: string, edit: (palette: PaletteJson) => void) {
  const palette = readJson(dir, 'palette.json') as PaletteJson;
  edit(palette);
  writeJson(dir, 'palette.json', palette);
}

function editStyle(dir: string, edit: (style: StyleJson) => void) {
  const style = readJson(dir, 'style.json') as StyleJson;
  edit(style);
  writeJson(dir, 'style.json', style);
}

function setHex(palette: PaletteJson, index: number, hex: (hexes: string[]) => string) {
  const color = palette.colors[index];
  if (color === undefined) throw new Error(`No palette color ${String(index)}`);
  color.hex = hex(palette.colors.map((entry) => entry.hex));
}

describe('the shipped style bible', () => {
  const bible = loadStyleBible();

  it('loads the current version from this package', () => {
    expect(bible.version).toBe(STYLE_BIBLE_VERSION);
    expect(bible.dir).toBe(styleBibleDir(STYLE_BIBLE_VERSION, DEFAULT_STYLE_BIBLE_DIR));
    expect(Object.keys(bible.templates).sort()).toEqual([...ASSET_KINDS].sort());
    // Notes for people are not sent to the model.
    expect(bible.base).not.toContain('<!--');
    for (const kind of ASSET_KINDS) expect(bible.templates[kind]).not.toContain('<!--');
  });

  it('keeps every palette color clear of the key color', () => {
    for (const color of bible.palette.colors) {
      expect(colorDistance(color.hex, bible.style.keyColor.hex)).toBeGreaterThanOrEqual(
        KEY_COLOR_MIN_DISTANCE,
      );
    }
  });

  it('builds a complete prompt for every kind, naming no franchise', () => {
    for (const kind of ASSET_KINDS) {
      const prompt = buildImagePrompt(bible, kind, {
        name: '  Old   Marta ',
        subject: subjectLines([['Appearance', 'a tall woman\nin a green coat']]),
      });
      expect(prompt.startsWith(bible.base)).toBe(true);
      expect(prompt).toContain('Name: Old Marta\nAppearance: a tall woman in a green coat');
      expect(prompt).not.toMatch(/\{\{|\}\}/);
      for (const word of FORBIDDEN_STYLE_WORDS) expect(prompt.toLowerCase()).not.toContain(word);
    }
  });

  it('puts the key color in cutout prompts only', () => {
    const subject = { name: 'Well', subject: '' };
    expect(buildImagePrompt(bible, 'prop', subject)).toContain('magenta (#FF00FF)');
    expect(buildImagePrompt(bible, 'character', subject)).toContain('magenta (#FF00FF)');
    expect(buildImagePrompt(bible, 'backdrop', subject)).not.toContain('#FF00FF');
  });

  it('ends cleanly when the record has nothing but a name', () => {
    expect(buildImagePrompt(bible, 'monster', { name: 'Grub', subject: '' })).toMatch(
      /Name: Grub$/,
    );
  });
});

describe('anchors', () => {
  const bible = loadStyleBible();

  it('ships two anchors for every kind, each on disk', () => {
    for (const kind of ASSET_KINDS) {
      const anchors = anchorsFor(bible, kind);
      expect(anchors).toHaveLength(2);
      for (const anchor of anchors) {
        expect(anchor.kind).toBe(kind);
        expect(anchor.file.startsWith(`${kind}-`)).toBe(true);
      }
    }
  });

  it('reads the kind and media type from a file name', () => {
    expect(anchorKindOf('monster-troll.webp')).toBe('monster');
    expect(anchorKindOf('backdrop-forest.png')).toBe('backdrop');
    expect(anchorKindOf('troll.webp')).toBeNull();
    expect(anchorKindOf('npc-troll.webp')).toBeNull();
    expect(anchorMediaType('prop-well.WEBP')).toBe('image/webp');
    expect(anchorMediaType('prop-well.jpg')).toBe('image/jpeg');
    expect(anchorMediaType('prop-well.png')).toBe('image/png');
    expect(anchorMediaType('notes.txt')).toBeNull();
  });
});

describe('subjectLines', () => {
  it('keeps filled fields in order, one line each, and drops empty ones', () => {
    expect(
      subjectLines([
        ['Kind', 'lantern'],
        ['Appearance', '   '],
        ['Description', null],
        ['Notes', undefined],
        ['Detail', ' brass,\n\n dented '],
      ]),
    ).toBe('Kind: lantern\nDetail: brass, dented');
    expect(subjectLines([])).toBe('');
  });
});

describe('loadStyleBible refuses a broken version', () => {
  let dir: string;
  beforeEach(() => {
    dir = copyOfV1();
  });

  it('a missing version or file', () => {
    expect(() => loadStyleBible(99, dir)).toThrow(StyleBibleError);
    rmSync(join(styleBibleDir(1, dir), 'templates', 'prop.md'));
    expect(() => loadStyleBible(1, dir)).toThrow(/not found: .*prop\.md/);
  });

  it('a template with a slot too many or too few', () => {
    const path = join(styleBibleDir(1, dir), 'templates', 'backdrop.md');
    writeFileSync(path, `${readFileSync(path, 'utf8')}\n{{key_color}}`);
    expect(() => loadStyleBible(1, dir)).toThrow(/backdrop\.md: needs exactly the slots/);
    writeFileSync(path, 'Draw {{name}}.');
    expect(() => loadStyleBible(1, dir)).toThrow(/has name$/);
  });

  it('a franchise name in the base style', () => {
    const path = join(styleBibleDir(1, dir), 'base.md');
    writeFileSync(path, `${readFileSync(path, 'utf8')}\nLike Paper Mario.`);
    expect(() => loadStyleBible(1, dir)).toThrow(/naming "paper mario"/);
  });

  it('a palette color that is not a color, repeated, or too close to the key color', () => {
    editPalette(dir, (palette) => {
      setHex(palette, 0, () => 'red');
    });
    expect(() => loadStyleBible(1, dir)).toThrow(/colors\.0\.hex/);

    dir = copyOfV1();
    editPalette(dir, (palette) => {
      setHex(palette, 1, (hexes) => (hexes[0] ?? '').toLowerCase());
    });
    expect(() => loadStyleBible(1, dir)).toThrow(/listed twice/);

    dir = copyOfV1();
    editPalette(dir, (palette) => {
      setHex(palette, 0, () => '#F010F0');
    });
    expect(() => loadStyleBible(1, dir)).toThrow(/too close to the key color/);
  });

  it('a style.json for another version, or bad JSON', () => {
    editStyle(dir, (style) => {
      style.version = 2;
    });
    expect(() => loadStyleBible(1, dir)).toThrow(/says version 2/);
    writeFileSync(join(styleBibleDir(1, dir), 'style.json'), '{ nope');
    expect(() => loadStyleBible(1, dir)).toThrow(/not valid JSON/);
  });

  it('an anchor whose image is missing, and finds one that is there', () => {
    editStyle(dir, (style) => {
      style.anchors = [{ file: 'character-hero.png', kind: 'character', subject: 'An adventurer' }];
    });
    expect(() => loadStyleBible(1, dir)).toThrow(/Anchor image not found: .*character-hero\.png/);
    mkdirSync(join(styleBibleDir(1, dir), 'anchors'), { recursive: true });
    writeFileSync(join(styleBibleDir(1, dir), 'anchors', 'character-hero.png'), 'png bytes');
    const bible = loadStyleBible(1, dir);
    expect(bible.anchors).toEqual([
      {
        file: 'character-hero.png',
        kind: 'character',
        subject: 'An adventurer',
        path: join(styleBibleDir(1, dir), 'anchors', 'character-hero.png'),
      },
    ]);
  });

  it('an anchor named for another kind, or too many for one kind', () => {
    editStyle(dir, (style) => {
      style.anchors = [{ file: 'prop-well.webp', kind: 'monster', subject: 'x' }];
    });
    expect(() => loadStyleBible(1, dir)).toThrow(/anchors\.0\.file: An anchor file name starts/);

    editStyle(dir, (style) => {
      style.anchors = Array.from({ length: ANCHORS_PER_KIND_MAX + 1 }, (_unused, index) => ({
        file: `prop-${String(index)}.webp`,
        kind: 'prop',
        subject: 'x',
      }));
    });
    expect(() => loadStyleBible(1, dir)).toThrow(/At most 4 anchors per kind/);
  });

  it('an anchor file name that could leave the folder', () => {
    editStyle(dir, (style) => {
      style.anchors = [{ file: '../base.md', kind: 'prop', subject: 'x' }];
    });
    expect(() => loadStyleBible(1, dir)).toThrow(/anchors\.0\.file/);
  });
});
