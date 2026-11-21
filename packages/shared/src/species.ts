/**
 * Species (F4.6, governance §8 "Species", D-64): gameplay records the GM enters. Every member of
 * the campaign reads them; only the GM creates, edits or deletes them. They are never revealed,
 * never take notes, and the AI never sees them.
 *
 * A species has a name, a description and its features: the things only it can do, read by the
 * table, not run by the app. The features are an ordered list, so the creation guide (F4.8) can
 * offer a mixed ancestry: the first feature of one species and the second of another. There is
 * no picture yet (19.19).
 */
import { z } from 'zod';

import { featureListSchema, featureRowSchema } from './classes';
import { textField } from './record-fields';
import { SHORT_TEXT_MAX } from './sheet-parts';

const timestamp = z.iso.datetime({ offset: true });

/** Longest species name. The database enforces it too. */
export const SPECIES_NAME_MAX = SHORT_TEXT_MAX;

export const speciesNameSchema = z
  .string()
  .trim()
  .min(1, 'Name cannot be empty')
  .max(SPECIES_NAME_MAX, `Name must be ${String(SPECIES_NAME_MAX)} characters or fewer`);

/** A species in a list. */
export const speciesSummarySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  description: z.string(),
  featureCount: z.int().nonnegative(),
  updatedAt: timestamp,
});
export type SpeciesSummary = z.infer<typeof speciesSummarySchema>;

/** A whole species. */
export const speciesRecordSchema = speciesSummarySchema.extend({
  /** In the GM's order: a mixed ancestry takes the first of one species and the second of another. */
  features: z.array(featureRowSchema),
  createdAt: timestamp,
});
export type SpeciesRecord = z.infer<typeof speciesRecordSchema>;

/** `GET /api/campaigns/:campaignId/species`: any member. By name. */
export const speciesListResponseSchema = z.object({ species: z.array(speciesSummarySchema) });
export type SpeciesListResponse = z.infer<typeof speciesListResponseSchema>;

/** `POST /api/campaigns/:campaignId/species`: the GM; refused while archived. */
export const createSpeciesRequestSchema = z.strictObject({ name: speciesNameSchema });
export type CreateSpeciesRequest = z.infer<typeof createSpeciesRequestSchema>;

/**
 * `PATCH /api/campaigns/:campaignId/species/:speciesId`: the GM; refused while archived. Any
 * subset of the keys; each replaces its whole value.
 */
export const updateSpeciesRequestSchema = z
  .strictObject({
    name: speciesNameSchema,
    description: textField,
    features: featureListSchema,
  })
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, 'Nothing to update');
export type UpdateSpeciesRequest = z.infer<typeof updateSpeciesRequestSchema>;
