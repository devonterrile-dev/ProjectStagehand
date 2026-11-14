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

/**
 * An asset's life (F2.3, D-42): `generating` while its job is queued or running, then
 * `pending` with an image or `failed` without one. The GM's "Use this one" makes it
 * `approved`; `rejected` arrives with review (F2.5).
 */
export const ASSET_STATUSES = ['generating', 'failed', 'pending', 'approved', 'rejected'] as const;
export const assetStatusSchema = z.enum(ASSET_STATUSES);
export type AssetStatus = z.infer<typeof assetStatusSchema>;

/**
 * What a visual can be made for (F2.3): four record types, and PC sheets (`pc`). Stat blocks
 * have no Generate visual button (yet).
 */
export const VISUAL_SUBJECTS = ['npc', 'prop', 'item', 'spot', 'pc'] as const;
export type VisualSubject = (typeof VISUAL_SUBJECTS)[number];

const VISUAL_KINDS: Record<VisualSubject, readonly AssetKind[]> = {
  // The GM says which (D-42): a goblin NPC is drawn with the monster template and anchors.
  npc: ['character', 'monster'],
  // A PC is always drawn as a humanoid puppet.
  pc: ['character'],
  prop: ['prop'],
  item: ['prop'],
  spot: ['backdrop'],
};

/** Whether a record type (or `pc`) can have a visual. */
export function isVisualSubject(subject: string): subject is VisualSubject {
  return (VISUAL_SUBJECTS as readonly string[]).includes(subject);
}

/** The asset kinds a subject may be drawn as; the first is the default. */
export function visualKindsFor(subject: VisualSubject): readonly AssetKind[] {
  return VISUAL_KINDS[subject];
}

export const VISUAL_ERROR_CODES = [
  'key_missing',
  'key_rejected',
  'key_forbidden',
  'no_credit',
  'rate_limited',
  'bad_request',
  'failed',
  'unreachable',
  'interrupted',
  'internal',
] as const;
export const visualErrorCodeSchema = z.enum(VISUAL_ERROR_CODES);
export type VisualErrorCode = z.infer<typeof visualErrorCodeSchema>;

/** What the GM is told when an image wasn't made. None of these cost anything. */
export const VISUAL_ERROR_MESSAGES: Record<VisualErrorCode, string> = {
  key_missing:
    "Your OpenRouter key was removed or can't be read. Add it in Settings and try again.",
  key_rejected: 'OpenRouter rejected your API key. Check it in Settings.',
  key_forbidden:
    "That OpenRouter key can't make images (it may be a management key). Add a normal API key in Settings.",
  no_credit: 'Your OpenRouter account is out of credit. Add credit, then try again.',
  rate_limited: 'OpenRouter is busy right now. Try again in a minute.',
  bad_request:
    "OpenRouter refused this request. Rewording the record's appearance or description may help.",
  failed: "The image model didn't send an image back. Try again.",
  unreachable: "Couldn't reach OpenRouter. Try again.",
  interrupted: 'The server stopped while this image was being made. Try again.',
  internal: 'Something went wrong while making this image. Try again.',
};

/** Cost guardrails (§11): per GM, across every campaign. */
export const VISUAL_LIMITS = {
  /** Images started in the last hour. */
  jobsPerHour: 30,
  /** Images being made at once. */
  generatingAtOnce: 3,
  /** A job still `generating` after this long was lost; it is shown and counted as failed. */
  generatingMaxMs: 15 * 60 * 1000,
  /** Tries listed on a record or PC, newest first. */
  listed: 12,
} as const;

/**
 * About what one image costs at the style bible's medium quality with its two anchors,
 * measured on the F2.1b test set (D-39). Shown before the GM clicks; the real cost is logged
 * per asset from OpenRouter's answer.
 */
export const VISUAL_COST_ESTIMATE_USD: Record<AssetKind, number> = {
  character: 0.055,
  monster: 0.055,
  prop: 0.071,
  backdrop: 0.044,
};

const timestamp = z.iso.datetime({ offset: true });

/** One try at a visual, as the record's or PC's Visual card shows it. */
export const assetSummarySchema = z.object({
  id: z.uuid(),
  kind: assetKindSchema,
  status: assetStatusSchema,
  /** Set when `status` is `failed`. */
  errorCode: visualErrorCodeSchema.nullable(),
  /** What OpenRouter charged, when it said; null while generating or after a failure. */
  costUsd: z.number().nonnegative().nullable(),
  /**
   * The stage's version of the image (F2.4, D-43): cut out, bordered and sized for cutouts,
   * sized for backdrops. Null until it has been made; the original is shown meanwhile.
   */
  processed: z
    .object({
      width: z.int().positive(),
      height: z.int().positive(),
      /** The post-processing version; part of the image URL, so a remake isn't cached. */
      version: z.int().positive(),
    })
    .nullable(),
  createdAt: timestamp,
  finishedAt: timestamp.nullable(),
});
export type AssetSummary = z.infer<typeof assetSummarySchema>;

/** `GET …/records/:recordId/visuals` and `…/characters/:characterId/visuals`. */
export const visualsResponseSchema = z.object({
  /** The asset in use (approved), or null. */
  visualAssetId: z.uuid().nullable(),
  /** The latest tries, newest first (at most `VISUAL_LIMITS.listed`). */
  assets: z.array(assetSummarySchema),
});
export type VisualsResponse = z.infer<typeof visualsResponseSchema>;

/**
 * `POST …/visuals`. `kind` is needed only where there is a choice (NPCs: humanoid `character`
 * or `monster`); elsewhere it may be left out, or must be the subject's own.
 */
export const generateVisualRequestSchema = z.strictObject({
  kind: assetKindSchema.optional(),
});
export type GenerateVisualRequest = z.infer<typeof generateVisualRequestSchema>;

/** `PUT …/visual`: use this try as the record's or PC's visual ("Use this one"). */
export const useVisualRequestSchema = z.strictObject({
  assetId: z.uuid(),
});
export type UseVisualRequest = z.infer<typeof useVisualRequestSchema>;

/** Which file of an asset: the stage's version (the default) or the model's original. */
export const ASSET_IMAGE_VARIANTS = ['processed', 'original'] as const;
export type AssetImageVariant = (typeof ASSET_IMAGE_VARIANTS)[number];

/** `GET …/assets/:assetId/image`: `?v=original` for the original, `p` only busts caches. */
export const assetImageQuerySchema = z.object({
  v: z.enum(ASSET_IMAGE_VARIANTS).default('processed'),
  p: z.string().max(10).optional(),
});

/**
 * The URL a GM's browser loads an asset's image from. Pass the asset's `processed` to show
 * the stage's version: its version goes in the URL, so a remade image isn't served from cache.
 * Without it (not made yet) the server falls back to the original.
 */
export function assetImagePath(
  campaignId: string,
  assetId: string,
  options: { variant?: AssetImageVariant; processed?: AssetSummary['processed'] } = {},
): string {
  const base = `/api/campaigns/${campaignId}/assets/${assetId}/image`;
  if (options.variant === 'original') return `${base}?v=original`;
  return options.processed == null ? base : `${base}?p=${String(options.processed.version)}`;
}
