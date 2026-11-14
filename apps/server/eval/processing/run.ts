/**
 * The post-processing tuning sheet (F2.4, D-43): runs `processImage` over images the model
 * already made, under one or more settings variants, and writes every result plus a sheet
 * (`index.html`) that shows each original beside its processed versions. Free: nothing is
 * called. Kept apart from the CLI so it can be tested.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';

import { isCutoutKind, type AssetKind } from '@stagehand/shared';
import sharp from 'sharp';

import { processImage, type ProcessingSettings } from '../../src/visuals/process';

export interface SourceImage {
  /** Unique within a run; used for file names. */
  name: string;
  kind: AssetKind;
  path: string;
}

export interface Variant {
  /** Short, file-name safe. */
  id: string;
  label: string;
  settings: ProcessingSettings;
  /** Which kinds this variant is shown for. */
  applies: 'cutouts' | 'backdrops';
}

export interface ProcessedResult {
  variant: string;
  /** Relative to the run folder; null when processing failed. */
  file: string | null;
  error: string | null;
  width: number | null;
  height: number | null;
  bytes: number | null;
  ms: number;
}

export interface SheetRow {
  name: string;
  kind: AssetKind;
  original: { file: string; width: number; height: number; bytes: number };
  results: ProcessedResult[];
}

export interface ProcessingRun {
  startedAt: string;
  variants: { id: string; label: string; applies: Variant['applies'] }[];
  rows: SheetRow[];
}

function appliesTo(variant: Variant, kind: AssetKind): boolean {
  return isCutoutKind(kind) ? variant.applies === 'cutouts' : variant.applies === 'backdrops';
}

/** Processes every source under every variant that applies to it; writes images and the sheet. */
export async function runProcessing(input: {
  sources: readonly SourceImage[];
  variants: readonly Variant[];
  outDir: string;
  now?: Date;
}): Promise<ProcessingRun> {
  mkdirSync(join(input.outDir, 'original'), { recursive: true });
  const rows: SheetRow[] = [];
  for (const source of input.sources) {
    const bytes = readFileSync(source.path);
    const meta = await sharp(bytes).metadata();
    // Originals are copied as a small preview: the sheet should open quickly.
    const preview = `original/${source.name}.webp`;
    await sharp(bytes)
      .resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 85 })
      .toFile(join(input.outDir, preview));

    const results: ProcessedResult[] = [];
    for (const variant of input.variants) {
      if (!appliesTo(variant, source.kind)) continue;
      mkdirSync(join(input.outDir, variant.id), { recursive: true });
      const started = performance.now();
      try {
        const processed = await processImage(bytes, source.kind, variant.settings);
        const ms = Math.round(performance.now() - started);
        const file = `${variant.id}/${source.name}.webp`;
        writeFileSync(join(input.outDir, file), processed.data);
        results.push({
          variant: variant.id,
          file,
          error: null,
          width: processed.width,
          height: processed.height,
          bytes: processed.data.length,
          ms,
        });
      } catch (error) {
        results.push({
          variant: variant.id,
          file: null,
          error: error instanceof Error ? error.message : String(error),
          width: null,
          height: null,
          bytes: null,
          ms: Math.round(performance.now() - started),
        });
      }
    }
    rows.push({
      name: source.name,
      kind: source.kind,
      original: {
        file: preview,
        width: meta.width,
        height: meta.height,
        bytes: bytes.length,
      },
      results,
    });
  }

  const run: ProcessingRun = {
    startedAt: (input.now ?? new Date()).toISOString(),
    variants: input.variants.map(({ id, label, applies }) => ({ id, label, applies })),
    rows,
  };
  writeFileSync(join(input.outDir, 'run.json'), JSON.stringify(run, null, 2));
  writeFileSync(join(input.outDir, 'index.html'), processingSheetHtml(run));
  return run;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function kb(bytes: number | null): string {
  return bytes === null ? '' : `${String(Math.round(bytes / 1024))} KB`;
}

/**
 * The sheet: one row per image, the original first, then each variant, on a checkerboard (to
 * see the transparency), a dark stage or a light table (a toggle). Click an image for full size.
 */
export function processingSheetHtml(run: ProcessingRun): string {
  const label = new Map(run.variants.map((variant) => [variant.id, variant.label]));
  const rows = run.rows
    .map((row) => {
      const original = `<figure class="original"><a href="${escapeHtml(row.original.file)}"><img src="${escapeHtml(
        row.original.file,
      )}" alt="${escapeHtml(row.name)}, original" loading="lazy"></a><figcaption><strong>Original</strong> · ${String(
        row.original.width,
      )}×${String(row.original.height)} · ${kb(row.original.bytes)}</figcaption></figure>`;
      const results = row.results
        .map((result) => {
          const picture =
            result.file === null
              ? `<div class="missing">${escapeHtml(result.error ?? 'failed')}</div>`
              : `<a href="${escapeHtml(result.file)}"><img src="${escapeHtml(result.file)}" alt="${escapeHtml(
                  row.name,
                )}, ${escapeHtml(label.get(result.variant) ?? result.variant)}" loading="lazy"></a>`;
          const size =
            result.width === null ? '' : ` · ${String(result.width)}×${String(result.height)}`;
          return `<figure class="processed">${picture}<figcaption><strong>${escapeHtml(
            label.get(result.variant) ?? result.variant,
          )}</strong>${size} · ${kb(result.bytes)} · ${String(result.ms)} ms</figcaption></figure>`;
        })
        .join('\n');
      return `<section class="${isCutoutKind(row.kind) ? '' : 'wide'}"><h2>${escapeHtml(row.name)} <span class="meta">${escapeHtml(
        row.kind,
      )}</span></h2><div class="row">${original}\n${results}</div></section>`;
    })
    .join('\n');
  const times = run.rows.flatMap((row) => row.results.map((result) => result.ms));
  const slowest = times.length === 0 ? 0 : Math.max(...times);
  const average =
    times.length === 0 ? 0 : Math.round(times.reduce((sum, ms) => sum + ms, 0) / times.length);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Processing ${escapeHtml(run.startedAt)}</title>
<style>
  :root { --bg: #f4efe6; --fg: #1e1a24; --card: #ffffff; --muted: #6b6475; }
  body { margin: 0; padding: 16px; background: var(--bg); color: var(--fg); font: 14px/1.4 system-ui, sans-serif; }
  header { display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: baseline; }
  h1 { font-size: 18px; margin: 0; }
  h2 { font-size: 15px; margin: 20px 0 6px; }
  .meta { color: var(--muted); font-weight: normal; }
  button { font: inherit; padding: 4px 10px; }
  button[aria-pressed="true"] { font-weight: 600; }
  .row { display: flex; flex-wrap: wrap; gap: 12px; align-items: flex-start; }
  figure { margin: 0; width: 260px; background: var(--card); padding: 8px; border-radius: 6px; }
  section.wide figure { width: 420px; }
  figure.processed a { display: block; background: var(--stage); }
  img { display: block; width: 100%; height: auto; }
  .missing { padding: 24px 8px; color: #c0392b; }
  figcaption { margin-top: 6px; font-size: 12px; color: var(--muted); }
  figcaption strong { color: var(--fg); }
  body[data-stage="checker"] { --stage: repeating-conic-gradient(#d9d4dc 0 25%, #ffffff 0 50%) 0 0 / 16px 16px; }
  body[data-stage="dark"] { --stage: #1b1820; }
  body[data-stage="wood"] { --stage: #6b4a2b; }
  @media (max-width: 560px) { figure, section.wide figure { width: 100%; } }
</style>
</head>
<body data-stage="checker">
<header>
  <h1>Post-processing ${escapeHtml(run.startedAt)}</h1>
  <span class="meta">${String(run.rows.length)} images · average ${String(average)} ms, slowest ${String(slowest)} ms</span>
  <span>Behind cutouts:
    <button type="button" data-stage="checker" aria-pressed="true">Checkerboard</button>
    <button type="button" data-stage="dark" aria-pressed="false">Dark stage</button>
    <button type="button" data-stage="wood" aria-pressed="false">Wood</button>
  </span>
</header>
<p class="meta">${run.variants.map((variant) => `<strong>${escapeHtml(variant.label)}</strong> (${variant.applies})`).join(' · ')}</p>
${rows}
<script>
  for (const button of document.querySelectorAll('button[data-stage]')) {
    button.addEventListener('click', () => {
      document.body.dataset.stage = button.dataset.stage;
      for (const other of document.querySelectorAll('button[data-stage]')) {
        other.setAttribute('aria-pressed', String(other === button));
      }
    });
  }
</script>
</body>
</html>
`;
}
