/**
 * The image style bible (F2.1, governance §11): `v<N>/` holds the base style, one prompt
 * template per asset kind, `style.json` (key color, aspect ratio and quality per kind, the
 * anchor images) and `palette.json`. Every asset records the version that made it.
 *
 * A released version is never edited: a change is a new folder and a bumped
 * `STYLE_BIBLE_VERSION`, like the AI prompts in `@stagehand/prompts`, whose note stripping and
 * `{{slot}}` filling this reuses.
 *
 * The image model can't return a transparent background, so the cutout kinds (puppets and
 * props) are drawn on a flat key color that post-processing removes (F2.4, D-38). The palette
 * keeps its distance from that color, so the removal can't eat into a cutout.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { fillPrompt, slotsOf, stripLeadingNote } from '@stagehand/prompts';
import {
  ASSET_KINDS,
  assetKindSchema,
  imageAspectRatioSchema,
  imageQualitySchema,
  isCutoutKind,
  type AssetKind,
} from '@stagehand/shared';
import { z } from 'zod';

/** The style bible new assets are made with. */
export const STYLE_BIBLE_VERSION = 1;

/** This package's folder: where the `v<N>/` folders are when running from source. */
export const DEFAULT_STYLE_BIBLE_DIR = fileURLToPath(new URL('..', import.meta.url));

/** How far (straight-line RGB distance) every palette color stays from the key color. */
export const KEY_COLOR_MIN_DISTANCE = 100;

/** Words that must never reach the image model: it describes the look instead (D-38). */
export const FORBIDDEN_STYLE_WORDS = ['paper mario', "dexter's lab", 'dexter’s lab', 'nintendo'];

export class StyleBibleError extends Error {
  override name = 'StyleBibleError';
}

export const hexColorSchema = z
  .string()
  .regex(/^#[0-9A-Fa-f]{6}$/, 'A color is # and six hex digits')
  .transform((hex) => hex.toUpperCase());

export const paletteSchema = z.strictObject({
  version: z.int().positive(),
  /** `draft` until the colors are taken from the approved anchors (F2.1b). */
  status: z.enum(['draft', 'final']),
  colors: z
    .array(
      z.strictObject({
        name: z.string().trim().min(1),
        group: z.string().trim().min(1),
        hex: hexColorSchema,
      }),
    )
    .min(8, 'A palette needs at least 8 colors')
    .max(64, 'A palette holds at most 64 colors'),
});
export type Palette = z.infer<typeof paletteSchema>;

const ANCHOR_FILE = /^[a-z0-9][a-z0-9-]*\.(png|webp|jpe?g)$/;

/**
 * Most anchors one kind may have. Each request carries only its own kind's anchors (D-39), and
 * every anchor adds about a cent to every image it is sent with.
 */
export const ANCHORS_PER_KIND_MAX = 4;

const kindSettingsSchema = z.strictObject({
  aspectRatio: imageAspectRatioSchema,
  quality: imageQualitySchema,
});

export const styleSchema = z.strictObject({
  version: z.int().positive(),
  /** The flat background cutouts are drawn on (D-38). The name is what the prompt says. */
  keyColor: z.strictObject({ name: z.string().trim().min(1), hex: hexColorSchema }),
  kinds: z.strictObject({
    character: kindSettingsSchema,
    monster: kindSettingsSchema,
    prop: kindSettingsSchema,
    backdrop: kindSettingsSchema,
  } satisfies Record<AssetKind, typeof kindSettingsSchema>),
  anchors: z
    .array(
      z
        .strictObject({
          /** A file in the version's `anchors/` folder, named `<kind>-<what>.<ext>`. */
          file: z.string().regex(ANCHOR_FILE, 'An anchor is a lowercase .png, .webp or .jpg name'),
          kind: assetKindSchema,
          /** What it shows, for people. Not sent to the model. */
          subject: z.string().trim().min(1),
        })
        .refine((anchor) => anchorKindOf(anchor.file) === anchor.kind, {
          error: 'An anchor file name starts with its kind, e.g. prop-well.webp',
          path: ['file'],
        }),
    )
    .refine(
      (anchors) =>
        ASSET_KINDS.every(
          (kind) => anchors.filter((anchor) => anchor.kind === kind).length <= ANCHORS_PER_KIND_MAX,
        ),
      `At most ${String(ANCHORS_PER_KIND_MAX)} anchors per kind`,
    ),
});
export type Style = z.infer<typeof styleSchema>;

/** The kind an anchor file is for, from its name (`monster-troll.webp` → monster), or null. */
export function anchorKindOf(file: string): AssetKind | null {
  return ASSET_KINDS.find((kind) => file.startsWith(`${kind}-`)) ?? null;
}

const ANCHOR_MEDIA_TYPES: Record<string, string> = {
  png: 'image/png',
  webp: 'image/webp',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
};

/** The media type of an anchor image from its extension, or null for anything else. */
export function anchorMediaType(file: string): string | null {
  return ANCHOR_MEDIA_TYPES[file.split('.').pop()?.toLowerCase() ?? ''] ?? null;
}

export interface Anchor {
  file: string;
  kind: AssetKind;
  subject: string;
  /** Absolute path to the image. */
  path: string;
}

export interface StyleBible {
  version: number;
  /** The version's folder. */
  dir: string;
  base: string;
  templates: Record<AssetKind, string>;
  style: Style;
  palette: Palette;
  anchors: Anchor[];
}

/** The `{{slots}}` each template must have, no more and no fewer. */
export function expectedSlots(kind: AssetKind): string[] {
  return isCutoutKind(kind) ? ['name', 'subject', 'key_color'] : ['name', 'subject'];
}

export function styleBibleDir(version: number, dir = DEFAULT_STYLE_BIBLE_DIR): string {
  return join(dir, `v${String(version)}`);
}

function readText(path: string): string {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    throw new StyleBibleError(`Style bible file not found: ${path}`);
  }
  const text = stripLeadingNote(raw);
  if (text === '') throw new StyleBibleError(`Style bible file is empty: ${path}`);
  return text;
}

function readJson<T>(path: string, schema: z.ZodType<T>): T {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readText(path));
  } catch (error) {
    if (error instanceof StyleBibleError) throw error;
    throw new StyleBibleError(`Style bible file is not valid JSON: ${path}`);
  }
  const result = schema.safeParse(parsed);
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    throw new StyleBibleError(`${path}: ${problems}`);
  }
  return result.data;
}

function rgbOf(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

/** Straight-line distance between two `#RRGGBB` colors in RGB space (0 to about 441). */
export function colorDistance(a: string, b: string): number {
  const [r1, g1, b1] = rgbOf(a);
  const [r2, g2, b2] = rgbOf(b);
  return Math.hypot(r1 - r2, g1 - g2, b1 - b2);
}

function checkPalette(palette: Palette, keyColor: string, path: string): void {
  const seen = new Set<string>();
  for (const color of palette.colors) {
    if (seen.has(color.hex)) throw new StyleBibleError(`${path}: ${color.hex} is listed twice`);
    seen.add(color.hex);
    if (colorDistance(color.hex, keyColor) < KEY_COLOR_MIN_DISTANCE) {
      throw new StyleBibleError(
        `${path}: ${color.name} (${color.hex}) is too close to the key color ${keyColor}`,
      );
    }
  }
}

function checkWords(text: string, path: string): void {
  const lower = text.toLowerCase();
  const found = FORBIDDEN_STYLE_WORDS.find((word) => lower.includes(word));
  if (found !== undefined) {
    throw new StyleBibleError(`${path}: describe the look instead of naming "${found}"`);
  }
}

/**
 * Reads and checks one style bible version: every file present and valid, each template with
 * exactly its slots, the palette clear of the key color, and every anchor image on disk.
 * Throws StyleBibleError naming the file at fault.
 */
export function loadStyleBible(
  version: number = STYLE_BIBLE_VERSION,
  dir = DEFAULT_STYLE_BIBLE_DIR,
): StyleBible {
  const root = styleBibleDir(version, dir);

  const basePath = join(root, 'base.md');
  const base = readText(basePath);
  checkWords(base, basePath);
  if (slotsOf(base).length > 0) {
    throw new StyleBibleError(`${basePath}: the base style has no slots`);
  }

  const templates = {} as Record<AssetKind, string>;
  for (const kind of ASSET_KINDS) {
    const path = join(root, 'templates', `${kind}.md`);
    const template = readText(path);
    checkWords(template, path);
    const slots = [...slotsOf(template)].sort();
    const expected = expectedSlots(kind).sort();
    if (slots.join() !== expected.join()) {
      throw new StyleBibleError(
        `${path}: needs exactly the slots ${expected.join(', ')}; has ${slots.join(', ') || 'none'}`,
      );
    }
    templates[kind] = template;
  }

  const stylePath = join(root, 'style.json');
  const style = readJson(stylePath, styleSchema);
  if (style.version !== version) {
    throw new StyleBibleError(`${stylePath}: says version ${String(style.version)}`);
  }

  const palettePath = join(root, 'palette.json');
  const palette = readJson(palettePath, paletteSchema);
  if (palette.version !== version) {
    throw new StyleBibleError(`${palettePath}: says version ${String(palette.version)}`);
  }
  checkPalette(palette, style.keyColor.hex, palettePath);

  const anchors = style.anchors.map((anchor) => {
    const path = join(root, 'anchors', anchor.file);
    if (!existsSync(path)) throw new StyleBibleError(`Anchor image not found: ${path}`);
    return { ...anchor, path };
  });

  return { version, dir: root, base, templates, style, palette, anchors };
}

/** One line of a subject: a label and the record's value for it. */
export type SubjectLine = readonly [label: string, value: string | null | undefined];

/**
 * The `{{subject}}` text: one `Label: value` line per field that has a value, each value on a
 * single line. Empty fields are left out, so a PC or a stat block with no appearance still
 * makes a clean prompt.
 */
export function subjectLines(lines: readonly SubjectLine[]): string {
  return lines
    .map(([label, value]) => [label, (value ?? '').replace(/\s+/g, ' ').trim()] as const)
    .filter(([, value]) => value !== '')
    .map(([label, value]) => `${label}: ${value}`)
    .join('\n');
}

export interface ImagePromptInput {
  name: string;
  /** From `subjectLines`. */
  subject: string;
}

/** The full text prompt for one image: the base style, then the kind's filled template. */
export function buildImagePrompt(
  bible: StyleBible,
  kind: AssetKind,
  input: ImagePromptInput,
): string {
  const { keyColor } = bible.style;
  const values: Record<string, string> = {
    name: input.name.replace(/\s+/g, ' ').trim(),
    subject: input.subject.trim(),
    ...(isCutoutKind(kind) ? { key_color: `${keyColor.name} (${keyColor.hex})` } : {}),
  };
  const filled = fillPrompt(bible.templates[kind], values)
    .replace(/[ \t]+$/gm, '')
    .trim();
  return `${bible.base}\n\n${filled}`;
}

/** The anchors sent with a request for one kind: that kind's own, never another's (D-39). */
export function anchorsFor(bible: StyleBible, kind: AssetKind): Anchor[] {
  return bible.anchors.filter((anchor) => anchor.kind === kind);
}
