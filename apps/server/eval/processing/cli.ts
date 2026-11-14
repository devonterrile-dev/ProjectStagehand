/**
 * `pnpm style:process`: the post-processing tuning sheet (F2.4, D-43). Runs the stage's
 * post-processing over images the model already made, under a few settings variants, and
 * writes a sheet to compare them with the originals. Free: nothing is called, no key is needed.
 *
 *   pnpm style:process                       every image in eval/results/images/* and var/assets
 *   pnpm style:process --in <folder>         only this folder (repeat for more)
 *   pnpm style:process --only well,lantern   only images whose name contains one of these
 *
 * Results go to the git-ignored `eval/results/processing/<time>/`: the processed images,
 * `run.json` and `index.html`.
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import type { AssetKind } from '@stagehand/shared';
import sharp from 'sharp';

import { DEFAULT_PROCESSING } from '../../src/visuals/process';

import { runProcessing, type SourceImage, type Variant } from './run';

const SERVER_DIR = fileURLToPath(new URL('../../', import.meta.url));
const RESULTS_DIR = join(SERVER_DIR, 'eval', 'results');
const IMAGE_EXTENSIONS = new Set(['.png', '.webp', '.jpg', '.jpeg']);

const { values } = parseArgs({
  options: {
    in: { type: 'string', multiple: true },
    only: { type: 'string' },
  },
});

function folders(): string[] {
  if (values.in !== undefined && values.in.length > 0) {
    // Relative to where `pnpm` was run, not to apps/server.
    const base = process.env['INIT_CWD'] ?? process.cwd();
    return values.in.map((folder) => resolve(base, folder));
  }
  const found: string[] = [];
  const runs = join(RESULTS_DIR, 'images');
  if (existsSync(runs)) {
    for (const name of readdirSync(runs).sort()) {
      if (/^\d{4}-\d{2}-\d{2}T/.test(name)) found.push(join(runs, name));
    }
  }
  const campaigns = join(SERVER_DIR, 'var', 'assets', 'campaigns');
  if (existsSync(campaigns)) {
    for (const name of readdirSync(campaigns)) found.push(join(campaigns, name));
  }
  return found;
}

const PREFIX_KINDS: [string, AssetKind][] = [
  ['backdrop-', 'backdrop'],
  ['monster-', 'monster'],
  ['npc-', 'character'],
  ['pc-', 'character'],
  ['character-', 'character'],
  ['prop-', 'prop'],
  ['item-', 'prop'],
];

/** The kind from the test set's file names, else from the shape: 16:9 is a backdrop. */
async function kindOf(path: string): Promise<AssetKind> {
  const name = basename(path);
  const named = PREFIX_KINDS.find(([prefix]) => name.startsWith(prefix));
  if (named !== undefined) return named[1];
  const { width, height } = await sharp(path).metadata();
  return Math.abs(width / height - 16 / 9) < 0.05 ? 'backdrop' : 'prop';
}

const only = values.only
  ?.split(',')
  .map((part) => part.trim())
  .filter(Boolean);

const sources: SourceImage[] = [];
for (const folder of folders()) {
  if (!statSync(folder, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error(`Not a folder: ${folder}`);
  }
  // A run folder (2026-11-13T22-03-46-738Z) by its time, anything else by its first 8 characters.
  const folderName = basename(folder);
  const tag = (
    /^\d{4}-\d{2}-\d{2}T/.test(folderName) ? folderName.slice(11, 19) : folderName.slice(0, 8)
  ).replace(/[^A-Za-z0-9-]/g, '-');
  for (const file of readdirSync(folder).sort()) {
    if (!IMAGE_EXTENSIONS.has(extname(file).toLowerCase())) continue;
    if (only !== undefined && !only.some((part) => file.includes(part))) continue;
    const path = join(folder, file);
    sources.push({
      name: `${tag}-${basename(file, extname(file))}`,
      kind: await kindOf(path),
      path,
    });
  }
}
if (sources.length === 0) throw new Error('No images found. Pass --in <folder>.');

/**
 * What the sheet compares. Today only the settings in use (D-43: paper card, no palette
 * mapping); add a variant here to try a change side by side, e.g. another border color.
 */
const variants: Variant[] = [
  { id: 'cutout', label: 'Paper card', applies: 'cutouts', settings: DEFAULT_PROCESSING },
  { id: 'backdrop', label: 'Backdrop', applies: 'backdrops', settings: DEFAULT_PROCESSING },
];

const startedAt = new Date();
const outDir = join(RESULTS_DIR, 'processing', startedAt.toISOString().replace(/[:.]/g, '-'));

console.log(
  `Processing ${String(sources.length)} images under ${String(variants.length)} variants…`,
);
const run = await runProcessing({ sources, variants, outDir, now: startedAt });
const failed = run.rows.flatMap((row) =>
  row.results
    .filter((result) => result.error !== null)
    .map((result) => `${row.name} (${result.variant}): ${result.error ?? ''}`),
);
for (const line of failed) console.log(`  failed: ${line}`);
console.log(`Sheet: ${join(outDir, 'index.html')}`);
