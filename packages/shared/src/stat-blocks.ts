/**
 * Stat blocks for monsters and NPCs (F1.4, governance §8 "Stat block"). A stat block is a
 * template: it holds HP and Stress maximums only. Each copy of a monster on stage tracks
 * its own current HP and Stress once battle scenes exist (F4.2, 19.9). NPC records link
 * one through `statBlockId`. GM only.
 */
import { z } from 'zod';

import { richTextSchema } from './rich-text';
import {
  abilitySchema,
  attackSchema,
  bonusSchema,
  experienceSchema,
  sheetListSchema,
  SHEET_NUMBER_MAX,
  sheetNumberSchema,
  shortTextSchema,
} from './sheet-parts';

/** Longest stat block name, the same as a record's. The database enforces it too. */
export const STAT_BLOCK_NAME_MAX = 120;
/** Most motives and tactics on one stat block, and the longest one. */
export const MOTIVES_MAX = 20;
export const MOTIVE_MAX = 200;

export const statBlockNameSchema = z
  .string()
  .trim()
  .min(1, 'Stat block name cannot be empty')
  .max(
    STAT_BLOCK_NAME_MAX,
    `Stat block name must be ${String(STAT_BLOCK_NAME_MAX)} characters or fewer`,
  );

export const tierSchema = z
  .int('Must be a whole number')
  .min(1, 'Tier must be 1 or more')
  .max(SHEET_NUMBER_MAX, `Must be ${String(SHEET_NUMBER_MAX)} or less`);

export const motiveSchema = z
  .string()
  .trim()
  .min(1, 'A motive cannot be empty')
  .max(MOTIVE_MAX, `A motive must be ${String(MOTIVE_MAX)} characters or fewer`);

export const motivesSchema = z
  .array(motiveSchema)
  .max(MOTIVES_MAX, `At most ${String(MOTIVES_MAX)} motives and tactics`);

const timestamp = z.iso.datetime({ offset: true });

/** An NPC record that links a stat block. */
export const statBlockUserSchema = z.object({ id: z.uuid(), name: z.string() });

/** A full stat block, as the GM sees it. */
export const statBlockSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  tier: z.int(),
  /** E.g. "Bruiser", "Skulk". Free text. */
  role: z.string(),
  publicDescription: richTextSchema,
  difficulty: z.int(),
  attackModifier: z.int(),
  standardAttack: attackSchema.nullable(),
  experiences: z.array(experienceSchema),
  motives: z.array(z.string()),
  features: z.array(abilitySchema),
  majorThreshold: z.int(),
  severeThreshold: z.int(),
  hpMax: z.int(),
  stressMax: z.int(),
  /** The NPC records that link this stat block, sorted by name. */
  usedBy: z.array(statBlockUserSchema),
  createdAt: timestamp,
  updatedAt: timestamp,
});
export type StatBlock = z.infer<typeof statBlockSchema>;

/** A stat block in a list. */
export const statBlockSummarySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  tier: z.int(),
  role: z.string(),
  /** How many NPC records link it. */
  usedByCount: z.int(),
  updatedAt: timestamp,
});
export type StatBlockSummary = z.infer<typeof statBlockSummarySchema>;

/** `GET /api/campaigns/:campaignId/stat-blocks`. GM only. Sorted by name. */
export const statBlockListResponseSchema = z.object({
  statBlocks: z.array(statBlockSummarySchema),
});
export type StatBlockListResponse = z.infer<typeof statBlockListResponseSchema>;

/** `POST /api/campaigns/:campaignId/stat-blocks`. GM only; refused while archived. */
export const createStatBlockRequestSchema = z.strictObject({
  name: statBlockNameSchema,
  tier: tierSchema.optional(),
  role: shortTextSchema.optional(),
});
export type CreateStatBlockRequest = z.infer<typeof createStatBlockRequestSchema>;

/**
 * `PATCH /api/campaigns/:campaignId/stat-blocks/:statBlockId`. GM only; refused while
 * archived. Any subset of the keys; each replaces its whole value. Null is allowed only
 * for `standardAttack`, where it removes the attack.
 */
export const updateStatBlockRequestSchema = z
  .strictObject({
    name: statBlockNameSchema.optional(),
    tier: tierSchema.optional(),
    role: shortTextSchema.optional(),
    publicDescription: richTextSchema.optional(),
    difficulty: sheetNumberSchema.optional(),
    attackModifier: bonusSchema.optional(),
    standardAttack: attackSchema.nullable().optional(),
    experiences: sheetListSchema(experienceSchema).optional(),
    motives: motivesSchema.optional(),
    features: sheetListSchema(abilitySchema).optional(),
    majorThreshold: sheetNumberSchema.optional(),
    severeThreshold: sheetNumberSchema.optional(),
    hpMax: sheetNumberSchema.optional(),
    stressMax: sheetNumberSchema.optional(),
  })
  .refine((patch) => Object.keys(patch).length > 0, 'Nothing to update');
export type UpdateStatBlockRequest = z.infer<typeof updateStatBlockRequestSchema>;
