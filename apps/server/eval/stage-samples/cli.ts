/**
 * `pnpm stage:samples`: makes the stage's bundled sample images (F3.1). Runs the style bible's
 * anchor images through the same post-processing as a generated visual (F2.4, D-43) and writes
 * them, with a manifest of their kinds and sizes, into the web app, which ships them for the
 * stage test page. Free: nothing is called, no key is needed.
 *
 * Run it again whenever `PROCESSING_VERSION` or the anchors change, and commit the result.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { assetKindSchema, type AssetKind } from '@stagehand/shared';

import { processImage } from '../../src/visuals/process';

const ANCHORS_DIR = fileURLToPath(
  new URL('../../../../packages/style-bible/v1/anchors/', import.meta.url),
);
const OUT_DIR = fileURLToPath(new URL('../../../web/src/stage/samples/', import.meta.url));

interface ManifestEntry {
  name: string;
  kind: AssetKind;
  width: number;
  height: number;
}

mkdirSync(OUT_DIR, { recursive: true });

const manifest: ManifestEntry[] = [];
for (const file of readdirSync(ANCHORS_DIR).sort()) {
  if (extname(file).toLowerCase() !== '.webp') continue;
  // Anchors are named `<kind>-<what>` (D-39).
  const name = basename(file, extname(file));
  const kind = assetKindSchema.parse(name.split('-')[0]);
  const processed = await processImage(readFileSync(join(ANCHORS_DIR, file)), kind);
  writeFileSync(join(OUT_DIR, `${name}.webp`), processed.data);
  manifest.push({ name, kind, width: processed.width, height: processed.height });
  console.log(
    `  ${name}: ${kind}, ${String(processed.width)} × ${String(processed.height)}, ` +
      `${String(Math.round(processed.data.length / 1024))} KB`,
  );
}
if (manifest.length === 0) throw new Error(`No anchor images found in ${ANCHORS_DIR}`);

writeFileSync(join(OUT_DIR, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Wrote ${String(manifest.length)} samples to ${OUT_DIR}`);
