/**
 * The stage's bundled sample images (F3.1): the style bible's anchors after post-processing,
 * made by `pnpm stage:samples`. The stage test page uses them, so it needs no campaign and
 * looks the same on every device.
 */
import { assetKindSchema, isCutoutKind, type AssetKind } from '@stagehand/shared';

import backdropForestPath from './samples/backdrop-forest-path.webp';
import backdropVillageSquare from './samples/backdrop-village-square.webp';
import characterRanger from './samples/character-ranger.webp';
import characterShopkeeper from './samples/character-shopkeeper.webp';
import manifest from './samples/manifest.json';
import monsterBogTroll from './samples/monster-bog-troll.webp';
import monsterCaveSpider from './samples/monster-cave-spider.webp';
import propLantern from './samples/prop-lantern.webp';
import propWell from './samples/prop-well.webp';

const URLS: Partial<Record<string, string>> = {
  'backdrop-forest-path': backdropForestPath,
  'backdrop-village-square': backdropVillageSquare,
  'character-ranger': characterRanger,
  'character-shopkeeper': characterShopkeeper,
  'monster-bog-troll': monsterBogTroll,
  'monster-cave-spider': monsterCaveSpider,
  'prop-lantern': propLantern,
  'prop-well': propWell,
};

export interface StageSample {
  /** The file's name, `<kind>-<what>`. */
  name: string;
  /** For people: "Forest path". */
  label: string;
  kind: AssetKind;
  url: string;
  /** The image's size in pixels, as post-processing left it. */
  width: number;
  height: number;
}

/** "backdrop-forest-path" → "Forest path". */
function labelOf(name: string): string {
  const words = name.split('-').slice(1).join(' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export const STAGE_SAMPLES: readonly StageSample[] = manifest.map((entry) => {
  const url = URLS[entry.name];
  if (url === undefined) {
    throw new Error(`Stage sample "${entry.name}" is in the manifest but is not imported`);
  }
  return {
    name: entry.name,
    label: labelOf(entry.name),
    kind: assetKindSchema.parse(entry.kind),
    url,
    width: entry.width,
    height: entry.height,
  };
});

export const SAMPLE_BACKDROPS = STAGE_SAMPLES.filter((sample) => sample.kind === 'backdrop');
export const SAMPLE_CUTOUTS = STAGE_SAMPLES.filter((sample) => isCutoutKind(sample.kind));
