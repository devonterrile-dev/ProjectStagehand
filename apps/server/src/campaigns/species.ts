/**
 * Species (F4.6, governance §8 "Species", D-64). Part of the campaign data-access layer: every
 * query is scoped to `scope.campaignId`. Every member reads them; callers check `assertGm` and
 * `assertWritable` before a change. Sheets using a species will keep it from being deleted (F4.7).
 */
import {
  speciesRecordSchema,
  speciesSummarySchema,
  type CreateSpeciesRequest,
  type SpeciesRecord,
  type SpeciesSummary,
  type UpdateSpeciesRequest,
} from '@stagehand/shared';
import { and, asc, eq, sql } from 'drizzle-orm';

import type { Database } from '../db/client';
import { isUniqueViolation } from '../db/pg-errors';
import { species } from '../db/schema';
import { httpError } from '../http/errors';

import type { DbOrTx } from './members';
import type { CampaignScope } from './scope';

const SPECIES_NOT_FOUND = 'Species not found';
const TAKEN = 'A species with that name already exists';

type SpeciesRow = typeof species.$inferSelect;

function scoped(scope: CampaignScope, speciesId: string) {
  return and(eq(species.id, speciesId), eq(species.campaignId, scope.campaignId));
}

function toSummary(row: SpeciesRow): SpeciesSummary {
  return speciesSummarySchema.parse({
    id: row.id,
    name: row.name,
    description: row.description,
    featureCount: row.features.length,
    updatedAt: row.updatedAt.toISOString(),
  });
}

function toSpecies(row: SpeciesRow): SpeciesRecord {
  return speciesRecordSchema.parse({
    ...toSummary(row),
    features: row.features,
    createdAt: row.createdAt.toISOString(),
  });
}

/** Runs a write that may give a species a name it already has: 409 in our words if so. */
async function namedOnce<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (error) {
    if (isUniqueViolation(error)) throw httpError(409, TAKEN);
    throw error;
  }
}

/** Every species of the campaign, by name. */
export async function listSpecies(db: DbOrTx, scope: CampaignScope): Promise<SpeciesSummary[]> {
  const rows = await db
    .select()
    .from(species)
    .where(eq(species.campaignId, scope.campaignId))
    .orderBy(asc(sql`lower(${species.name})`), asc(species.createdAt));
  return rows.map(toSummary);
}

export async function getSpecies(
  db: DbOrTx,
  scope: CampaignScope,
  speciesId: string,
): Promise<SpeciesRecord> {
  const [row] = await db.select().from(species).where(scoped(scope, speciesId));
  if (row === undefined) throw httpError(404, SPECIES_NOT_FOUND);
  return toSpecies(row);
}

export async function createSpecies(
  db: Database,
  scope: CampaignScope,
  request: CreateSpeciesRequest,
): Promise<SpeciesRecord> {
  const [row] = await namedOnce(() =>
    db.insert(species).values({ campaignId: scope.campaignId, name: request.name }).returning(),
  );
  if (row === undefined) throw new Error('species insert returned no row');
  return toSpecies(row);
}

/** Applies a partial update. Last write wins. */
export async function updateSpecies(
  db: Database,
  scope: CampaignScope,
  speciesId: string,
  patch: UpdateSpeciesRequest,
): Promise<SpeciesRecord> {
  const [row] = await namedOnce(() =>
    db.update(species).set(patch).where(scoped(scope, speciesId)).returning(),
  );
  if (row === undefined) throw httpError(404, SPECIES_NOT_FOUND);
  return toSpecies(row);
}

export async function deleteSpecies(
  db: Database,
  scope: CampaignScope,
  speciesId: string,
): Promise<void> {
  const removed = await db
    .delete(species)
    .where(scoped(scope, speciesId))
    .returning({ id: species.id });
  if (removed.length === 0) throw httpError(404, SPECIES_NOT_FOUND);
}
