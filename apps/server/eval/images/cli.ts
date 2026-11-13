/**
 * `pnpm style:sample`: draws the fixed image test set (F2.1, D-38) with the style bible,
 * through OpenRouter, with the key in `OPENROUTER_API_KEY` (git-ignored `apps/server/.env`).
 * Each image costs real money, so it runs by hand, never in CI. Start with `--dry-run`, which
 * prints every prompt and a quote and calls nothing.
 *
 *   pnpm style:sample --dry-run                  prompts and a quote, free
 *   pnpm style:sample                            the whole set once, with the style bible's anchors
 *   pnpm style:sample --reps 2                   each subject twice
 *   pnpm style:sample --only prop-well,npc-sailor
 *   pnpm style:sample --anchors <folder>         try candidate anchors, named <kind>-<what>.<ext>
 *   pnpm style:sample --no-anchors               send no reference images
 *   pnpm style:sample --model <slug>             another OpenRouter image model (§11 model swap)
 *   pnpm style:sample --style-version <N>        another style bible version
 *
 * Results go to the git-ignored `eval/results/images/<time>/`: the images, `run.json` and
 * `index.html`, a contact sheet to open in a browser. The key is never printed.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { IMAGE_MODEL, type AssetKind } from '@stagehand/shared';
import {
  ANCHORS_PER_KIND_MAX,
  anchorKindOf,
  anchorMediaType,
  loadStyleBible,
  STYLE_BIBLE_VERSION,
} from '@stagehand/style-bible';

import { createOpenRouterProvider, type ReferenceImage } from '../../src/providers/openrouter';

import {
  measuredCosts,
  quoteUsd,
  runSamples,
  sampleJobs,
  type ReferenceNames,
  type ReferencesByKind,
  type RunRecord,
  type SampleResult,
} from './run';
import { TEST_SET } from './test-set';

const RESULTS_DIR = fileURLToPath(new URL('../results/images/', import.meta.url));

const { values } = parseArgs({
  options: {
    'dry-run': { type: 'boolean', default: false },
    reps: { type: 'string', default: '1' },
    only: { type: 'string' },
    anchors: { type: 'string' },
    'no-anchors': { type: 'boolean', default: false },
    model: { type: 'string', default: IMAGE_MODEL },
    'style-version': { type: 'string', default: String(STYLE_BIBLE_VERSION) },
    concurrency: { type: 'string', default: '3' },
  },
});

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function positiveInt(name: string, raw: string): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) fail(`--${name} must be a whole number of 1 or more`);
  return value;
}

const reps = positiveInt('reps', values.reps);
const concurrency = positiveInt('concurrency', values.concurrency);
const bible = loadStyleBible(positiveInt('style-version', values['style-version']));

let subjects = TEST_SET;
if (values.only !== undefined) {
  const ids = values.only.split(',').map((id) => id.trim());
  const unknown = ids.filter((id) => !TEST_SET.some((subject) => subject.id === id));
  if (unknown.length > 0) {
    fail(
      `Unknown subject(s): ${unknown.join(', ')}\nKnown: ${TEST_SET.map((s) => s.id).join(', ')}`,
    );
  }
  subjects = TEST_SET.filter((subject) => ids.includes(subject.id));
}

if (values.anchors !== undefined && values['no-anchors']) {
  fail('Pass --anchors or --no-anchors, not both');
}

/**
 * The reference images by kind (D-39): a candidate folder, none, or the style bible's own
 * anchors. A candidate file's kind comes from its name (`monster-troll.webp`).
 */
function loadReferences(): { names: ReferenceNames; images: ReferencesByKind } {
  if (values['no-anchors']) return { names: {}, images: {} };
  const files: { kind: AssetKind; path: string }[] =
    values.anchors === undefined
      ? bible.anchors.map((anchor) => ({ kind: anchor.kind, path: anchor.path }))
      : (() => {
          // Relative to where the command was typed: pnpm runs this from apps/server.
          const dir = resolve(process.env['INIT_CWD'] ?? process.cwd(), values.anchors);
          if (!existsSync(dir)) fail(`No such folder: ${dir}`);
          return readdirSync(dir)
            .filter((file) => anchorMediaType(file) !== null)
            .sort()
            .map((file) => {
              const kind = anchorKindOf(file);
              if (kind === null) {
                fail(`${file}: name a candidate anchor <kind>-<what>, e.g. prop-well.webp`);
              }
              return { kind, path: join(dir, file) };
            });
        })();
  const names: ReferenceNames = {};
  const images: Partial<Record<AssetKind, ReferenceImage[]>> = {};
  for (const { kind, path } of files) {
    (names[kind] ??= []).push(basename(path));
    (images[kind] ??= []).push({
      data: readFileSync(path),
      mediaType: anchorMediaType(path) ?? 'image/png',
    });
  }
  for (const [kind, list] of Object.entries(images)) {
    if (list.length > ANCHORS_PER_KIND_MAX) {
      fail(`At most ${String(ANCHORS_PER_KIND_MAX)} ${kind} anchors; found ${String(list.length)}`);
    }
  }
  return { names, images };
}

/** Costs measured by the most recent run, so the quote improves after the first one. */
function lastMeasured(): ReturnType<typeof measuredCosts> {
  if (!existsSync(RESULTS_DIR)) return {};
  const runs = readdirSync(RESULTS_DIR)
    .filter((dir) => existsSync(join(RESULTS_DIR, dir, 'run.json')))
    .sort()
    .reverse();
  for (const dir of runs) {
    try {
      const record = JSON.parse(
        readFileSync(join(RESULTS_DIR, dir, 'run.json'), 'utf8'),
      ) as RunRecord;
      const measured = measuredCosts(record.results);
      if (Object.keys(measured).length > 0) return measured;
    } catch {
      // A broken run.json: try the one before.
    }
  }
  return {};
}

function describeReferences(names: ReferenceNames): string {
  const parts = Object.entries(names).map(([kind, list]) => `${kind}: ${list.join(', ')}`);
  return parts.length === 0 ? 'none' : parts.join('; ');
}

const references = loadReferences();
const jobs = sampleJobs(bible, subjects, reps);
const measured = lastMeasured();
const quote = quoteUsd(bible, jobs, measured);
const basis =
  Object.keys(measured).length > 0 ? 'costs measured by the last run' : 'a guess per image';

console.log(
  `Style bible v${String(bible.version)} · ${values.model} · ${String(jobs.length)} image(s) · references: ${describeReferences(
    references.names,
  )}`,
);
console.log(`Quote: about $${quote.toFixed(2)} (${basis})`);

if (values['dry-run']) {
  for (const subject of subjects) {
    const job = jobs.find((candidate) => candidate.subject === subject);
    const settings = bible.style.kinds[subject.kind];
    console.log(
      `\n=== ${subject.id} (${subject.kind}, ${settings.aspectRatio}, ${settings.quality}) ===\n${job?.prompt ?? ''}`,
    );
  }
  console.log(`\nDry run: nothing was sent. Quote: about $${quote.toFixed(2)}.`);
  process.exit(0);
}

const apiKey = process.env['OPENROUTER_API_KEY']?.trim() ?? '';
if (apiKey === '') {
  fail('Set OPENROUTER_API_KEY in apps/server/.env first (or run with --dry-run).');
}

const startedAt = new Date().toISOString();
const outDir = join(RESULTS_DIR, startedAt.replace(/[:.]/g, '-'));
mkdirSync(outDir, { recursive: true });

const report = (result: SampleResult) => {
  const cost = result.costUsd === null ? '' : ` $${result.costUsd.toFixed(3)}`;
  const why = result.message === null ? '' : ` ${result.message}`;
  console.log(
    `${result.status === 'ok' ? 'ok  ' : 'FAIL'} ${result.id} r${String(result.rep)} ${result.status}${cost} ${String(result.seconds)}s${why}`,
  );
};

const record = await runSamples({
  provider: createOpenRouterProvider(),
  apiKey,
  bible,
  jobs,
  references: references.images,
  info: {
    startedAt,
    model: values.model,
    styleBibleVersion: bible.version,
    references: references.names,
    reps,
  },
  outDir,
  concurrency,
  onResult: report,
});

const failed = record.results.filter((result) => result.status !== 'ok').length;
console.log(
  `\nDone: ${String(record.results.length - failed)} image(s), ${String(failed)} failed, $${record.totalCostUsd.toFixed(3)} charged.`,
);
console.log(`Contact sheet: ${join(outDir, 'index.html')}`);
if (failed > 0) process.exitCode = 1;
