/**
 * One sample run of the image test set (F2.1, D-38): build each subject's prompt from the
 * style bible, call the image model, and write every image, `run.json` and a contact sheet
 * (`index.html`) into the run's folder. Kept apart from the CLI so it can be tested with a
 * fake provider.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { AssetKind, ImageQuality } from '@stagehand/shared';
import { buildImagePrompt, subjectLines, type StyleBible } from '@stagehand/style-bible';

import type {
  ImageCallResult,
  OpenRouterProvider,
  ReferenceImage,
} from '../../src/providers/openrouter';

import type { TestSubject } from './test-set';

export interface SampleJob {
  subject: TestSubject;
  rep: number;
  prompt: string;
}

export interface SampleResult {
  id: string;
  kind: AssetKind;
  source: string;
  name: string;
  rep: number;
  prompt: string;
  status: ImageCallResult['status'];
  /** The image's file name in the run folder, when there is one. */
  file: string | null;
  costUsd: number | null;
  seconds: number;
  /** Why OpenRouter refused the request, for `bad_request`. */
  message: string | null;
}

export interface RunInfo {
  startedAt: string;
  model: string;
  styleBibleVersion: number;
  /** Names of the reference images sent with every request. */
  references: string[];
  reps: number;
}

export interface RunRecord extends RunInfo {
  results: SampleResult[];
  totalCostUsd: number;
}

/** Every subject × rep, in test set order, with its prompt. */
export function sampleJobs(
  bible: StyleBible,
  subjects: readonly TestSubject[],
  reps: number,
): SampleJob[] {
  return subjects.flatMap((subject) => {
    const prompt = buildImagePrompt(bible, subject.kind, {
      name: subject.name,
      subject: subjectLines(subject.lines),
    });
    return Array.from({ length: reps }, (_unused, index) => ({ subject, rep: index + 1, prompt }));
  });
}

/** Guessed cost of one image by quality, before any run has measured it. */
export const IMAGE_COST_GUESS_USD: Record<ImageQuality, number> = {
  low: 0.03,
  medium: 0.08,
  high: 0.25,
};

/**
 * The quote for a set of jobs: each kind at the average cost a previous run measured for it,
 * or at the guess for its quality when no run has.
 */
export function quoteUsd(
  bible: StyleBible,
  jobs: readonly SampleJob[],
  measured: Partial<Record<AssetKind, number>> = {},
): number {
  return jobs.reduce((sum, job) => {
    const kind = job.subject.kind;
    return sum + (measured[kind] ?? IMAGE_COST_GUESS_USD[bible.style.kinds[kind].quality]);
  }, 0);
}

/** Average measured cost per kind over the images a run produced. */
export function measuredCosts(
  results: readonly SampleResult[],
): Partial<Record<AssetKind, number>> {
  const totals = new Map<AssetKind, { sum: number; count: number }>();
  for (const result of results) {
    if (result.status !== 'ok' || result.costUsd === null) continue;
    const total = totals.get(result.kind) ?? { sum: 0, count: 0 };
    totals.set(result.kind, { sum: total.sum + result.costUsd, count: total.count + 1 });
  }
  const averages: Partial<Record<AssetKind, number>> = {};
  for (const [kind, { sum, count }] of totals) averages[kind] = sum / count;
  return averages;
}

export interface RunSamplesInput {
  provider: OpenRouterProvider;
  apiKey: string;
  bible: StyleBible;
  jobs: readonly SampleJob[];
  references: readonly ReferenceImage[];
  info: RunInfo;
  outDir: string;
  concurrency: number;
  /** Called as each image finishes, for progress output. */
  onResult?: (result: SampleResult) => void;
  now?: () => number;
}

function extensionOf(mediaType: string): string {
  if (mediaType === 'image/webp') return 'webp';
  if (mediaType === 'image/jpeg') return 'jpg';
  return 'png';
}

export async function runSamples(input: RunSamplesInput): Promise<RunRecord> {
  const now = input.now ?? Date.now;
  const results: SampleResult[] = new Array<SampleResult>(input.jobs.length);
  let next = 0;

  const worker = async () => {
    while (next < input.jobs.length) {
      const index = next++;
      const job = input.jobs[index];
      if (job === undefined) return;
      const { subject } = job;
      const settings = input.bible.style.kinds[subject.kind];
      const started = now();
      const call = await input.provider.generateImage({
        apiKey: input.apiKey,
        model: input.info.model,
        prompt: job.prompt,
        references: input.references,
        aspectRatio: settings.aspectRatio,
        quality: settings.quality,
      });
      let file: string | null = null;
      if (call.status === 'ok') {
        file = `${subject.id}-r${String(job.rep)}.${extensionOf(call.mediaType)}`;
        writeFileSync(join(input.outDir, file), call.image);
      }
      const result: SampleResult = {
        id: subject.id,
        kind: subject.kind,
        source: subject.source,
        name: subject.name,
        rep: job.rep,
        prompt: job.prompt,
        status: call.status,
        file,
        costUsd: call.status === 'ok' ? call.costUsd : null,
        seconds: Math.round((now() - started) / 100) / 10,
        message: call.status === 'bad_request' ? call.message : null,
      };
      results[index] = result;
      input.onResult?.(result);
    }
  };
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(input.concurrency, input.jobs.length)) }, worker),
  );

  const record: RunRecord = {
    ...input.info,
    results,
    totalCostUsd: results.reduce((sum, result) => sum + (result.costUsd ?? 0), 0),
  };
  writeFileSync(join(input.outDir, 'run.json'), `${JSON.stringify(record, null, 2)}\n`);
  writeFileSync(join(input.outDir, 'index.html'), contactSheetHtml(record));
  return record;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function money(usd: number | null): string {
  return usd === null ? 'cost unknown' : `$${usd.toFixed(3)}`;
}

/**
 * The contact sheet: every image of the run side by side, grouped by kind, on a light or a dark
 * table (a toggle), with each prompt behind a disclosure. "Do these look like one set?" is the
 * question it answers (the Phase 2 exit).
 */
export function contactSheetHtml(record: RunRecord): string {
  const kinds: AssetKind[] = ['character', 'monster', 'prop', 'backdrop'];
  const sections = kinds
    .map((kind) => {
      const results = record.results.filter((result) => result.kind === kind);
      if (results.length === 0) return '';
      const tiles = results
        .map((result) => {
          const picture =
            result.file === null
              ? `<div class="missing">${escapeHtml(result.status)}${
                  result.message === null ? '' : `: ${escapeHtml(result.message)}`
                }</div>`
              : `<img src="${escapeHtml(result.file)}" alt="${escapeHtml(result.name)}" loading="lazy">`;
          return `<figure class="${kind === 'backdrop' ? 'wide' : ''}">${picture}<figcaption><strong>${escapeHtml(
            result.name,
          )}</strong> · ${escapeHtml(result.source)} · rep ${String(result.rep)} · ${money(
            result.costUsd,
          )} · ${String(result.seconds)} s<details><summary>Prompt</summary><pre>${escapeHtml(
            result.prompt,
          )}</pre></details></figcaption></figure>`;
        })
        .join('\n');
      return `<h2>${kind}</h2>\n<div class="grid">\n${tiles}\n</div>`;
    })
    .join('\n');
  const references =
    record.references.length === 0 ? 'none' : escapeHtml(record.references.join(', '));
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Style sample ${escapeHtml(record.startedAt)}</title>
<style>
  :root { --bg: #f4efe6; --fg: #1e1a24; --card: #ffffff; --muted: #6b6475; }
  body.dark { --bg: #1b1820; --fg: #f4efe6; --card: #2a2631; --muted: #a59fb0; }
  body { margin: 0; padding: 16px; background: var(--bg); color: var(--fg); font: 14px/1.4 system-ui, sans-serif; }
  header { display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: baseline; }
  h1 { font-size: 18px; margin: 0; }
  h2 { text-transform: capitalize; font-size: 16px; margin: 24px 0 8px; }
  .meta { color: var(--muted); }
  button { font: inherit; padding: 4px 10px; }
  .grid { display: flex; flex-wrap: wrap; gap: 12px; align-items: flex-start; }
  figure { margin: 0; width: 240px; background: var(--card); padding: 8px; border-radius: 6px; }
  figure.wide { width: 480px; }
  img { display: block; width: 100%; height: auto; }
  .missing { padding: 24px 8px; color: #c0392b; }
  figcaption { margin-top: 6px; font-size: 12px; color: var(--muted); }
  figcaption strong { color: var(--fg); }
  pre { white-space: pre-wrap; font-size: 11px; max-height: 240px; overflow: auto; }
  @media (max-width: 520px) { figure, figure.wide { width: 100%; } }
</style>
</head>
<body>
<header>
  <h1>Style sample</h1>
  <span class="meta">${escapeHtml(record.startedAt)} · ${escapeHtml(record.model)} · style bible v${String(
    record.styleBibleVersion,
  )} · references: ${references} · total ${money(record.totalCostUsd)}</span>
  <button type="button" onclick="document.body.classList.toggle('dark')">Light / dark table</button>
</header>
${sections}
</body>
</html>
`;
}
