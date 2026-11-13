import { z } from 'zod';

/**
 * Visual assets (Phase 2, governance §11). One image per record, stat block or PC, made from
 * a style bible template of the asset's kind. The kinds match `assets.kind` in §8.
 *
 * - `character`: a PC or NPC puppet.
 * - `monster`: a stat block's puppet.
 * - `prop`: a Prop or Item record, shown as a cardboard standee.
 * - `backdrop`: a Spot's back-wall scenery, 16:9.
 */
export const ASSET_KINDS = ['character', 'monster', 'prop', 'backdrop'] as const;
export const assetKindSchema = z.enum(ASSET_KINDS);
export type AssetKind = z.infer<typeof assetKindSchema>;

/** Kinds cut out of their background and placed in the theater as cardboard (D-38). */
export const CUTOUT_ASSET_KINDS = [
  'character',
  'monster',
  'prop',
] as const satisfies readonly AssetKind[];

export function isCutoutKind(kind: AssetKind): boolean {
  return (CUTOUT_ASSET_KINDS as readonly AssetKind[]).includes(kind);
}

/** The image model, as an OpenRouter model slug (§11: one config value, D-11). */
export const IMAGE_MODEL = 'openai/gpt-image-2';

export const IMAGE_QUALITIES = ['low', 'medium', 'high'] as const;
export const imageQualitySchema = z.enum(IMAGE_QUALITIES);
export type ImageQuality = z.infer<typeof imageQualitySchema>;

/** The aspect ratios gpt-image-2 accepts through OpenRouter that the style bible may use. */
export const IMAGE_ASPECT_RATIOS = ['1:1', '2:3', '3:2', '3:4', '4:3', '16:9', '9:16'] as const;
export const imageAspectRatioSchema = z.enum(IMAGE_ASPECT_RATIOS);
export type ImageAspectRatio = z.infer<typeof imageAspectRatioSchema>;
