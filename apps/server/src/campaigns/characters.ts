/**
 * Player characters and their sheets (F1.2, F1.4; governance §7, §8). Part of the campaign
 * data-access layer: every query is scoped to `scope.campaignId`.
 *
 * The GM reads and edits every sheet. A player reads only the PC assigned to them, built
 * by `toPlayerCharacterSheet` from an explicit allow-list, and edits nothing (D-23).
 */
import {
  characterSchema,
  characterSheetPatchSchemaFor,
  characterSheetSchema,
  playerCharacterSheetSchema,
  rulesetFor,
  type Character,
  type CharacterSheet,
  type PlayerCharacterSheet,
} from '@stagehand/shared';
import { and, asc, eq, sql } from 'drizzle-orm';
import type { PgUpdateSetSource } from 'drizzle-orm/pg-core';
import type { ZodError } from 'zod';

import type { Database } from '../db/client';
import { campaignMembers, characters } from '../db/schema';
import { httpError } from '../http/errors';

import { assignCharacterIn, type DbOrTx } from './members';
import { requireInventoryItems } from './record-links';
import type { CampaignScope } from './scope';

type CharacterRow = typeof characters.$inferSelect;

const NOT_FOUND = 'Character not found';

/** `id = characterId and campaign_id = scope.campaignId`. */
function scoped(scope: CampaignScope, characterId: string) {
  return and(eq(characters.id, characterId), eq(characters.campaignId, scope.campaignId));
}

/** The member row holding a PC, joined on both columns of the composite FK. */
const holder = and(
  eq(campaignMembers.characterId, characters.id),
  eq(campaignMembers.campaignId, characters.campaignId),
);

/**
 * The GM's view of a sheet. Every trait of the campaign's ruleset is present (a missing one
 * reads as 0), and the stored JSON is re-checked on the way out.
 */
function toCharacterSheet(
  scope: CampaignScope,
  row: CharacterRow,
  assignedToUserId: string | null,
): CharacterSheet {
  const ruleset = rulesetFor(scope.campaign.rulesetVersion);
  const traits = Object.fromEntries(
    ruleset.traits.map((trait) => [trait.id, row.traits[trait.id] ?? 0]),
  );
  return characterSheetSchema.parse({
    id: row.id,
    name: row.name,
    assignedToUserId,
    level: row.level,
    className: row.className,
    publicDescription: row.publicDescription,
    gmNotes: row.gmNotes,
    traits,
    evasion: row.evasion,
    armorScore: row.armorScore,
    armorSlotsMax: row.armorSlotsMax,
    armorSlotsMarked: row.armorSlotsMarked,
    minorThreshold: row.minorThreshold,
    majorThreshold: row.majorThreshold,
    severeThreshold: row.severeThreshold,
    hpMax: row.hpMax,
    hpCurrent: row.hpCurrent,
    stressMax: row.stressMax,
    stressCurrent: row.stressCurrent,
    hope: row.hope,
    proficiency: row.proficiency,
    experiences: row.experiences,
    weapons: row.weapons,
    armor: row.armor,
    inventory: row.inventory,
    gold: row.gold,
    classFeature: row.classFeature,
    combatOptions: row.combatOptions,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}

/**
 * A player's view of their own sheet: each allowed key copied by name (governance §7 rule
 * 5). Never spread the GM's sheet here; a new private key must not leak by default.
 */
function toPlayerCharacterSheet(sheet: CharacterSheet): PlayerCharacterSheet {
  return playerCharacterSheetSchema.parse({
    id: sheet.id,
    name: sheet.name,
    level: sheet.level,
    className: sheet.className,
    publicDescription: sheet.publicDescription,
    traits: sheet.traits,
    evasion: sheet.evasion,
    armorScore: sheet.armorScore,
    armorSlotsMax: sheet.armorSlotsMax,
    armorSlotsMarked: sheet.armorSlotsMarked,
    minorThreshold: sheet.minorThreshold,
    majorThreshold: sheet.majorThreshold,
    severeThreshold: sheet.severeThreshold,
    hpMax: sheet.hpMax,
    hpCurrent: sheet.hpCurrent,
    stressMax: sheet.stressMax,
    stressCurrent: sheet.stressCurrent,
    hope: sheet.hope,
    proficiency: sheet.proficiency,
    experiences: sheet.experiences,
    weapons: sheet.weapons,
    armor: sheet.armor,
    // Name and detail only: the Item record link is the GM's (D-24).
    inventory: sheet.inventory.map(({ name, detail }) => ({ name, detail })),
    gold: sheet.gold,
    classFeature: sheet.classFeature,
    combatOptions: sheet.combatOptions,
    createdAt: sheet.createdAt,
    updatedAt: sheet.updatedAt,
  });
}

/** Every PC in the campaign, by name, with the player who has it. */
export async function listCharacters(db: Database, scope: CampaignScope): Promise<Character[]> {
  const rows = await db
    .select({
      id: characters.id,
      name: characters.name,
      assignedToUserId: campaignMembers.userId,
    })
    .from(characters)
    .leftJoin(campaignMembers, holder)
    .where(eq(characters.campaignId, scope.campaignId))
    .orderBy(asc(sql`lower(${characters.name})`), asc(characters.createdAt));

  return rows.map((row) => characterSchema.parse(row));
}

/**
 * Creates a PC with a blank sheet, and gives it to `assignToUserId` (a player in this
 * campaign) if set. Callers check `assertGm` and `assertWritable`.
 */
export async function createCharacter(
  db: Database,
  scope: CampaignScope,
  name: string,
  assignToUserId?: string,
): Promise<Character> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(characters)
      .values({ campaignId: scope.campaignId, name })
      .returning({ id: characters.id, name: characters.name });
    if (row === undefined) throw new Error('character insert returned no row');

    if (assignToUserId !== undefined) {
      await assignCharacterIn(tx, scope, assignToUserId, row.id);
    }
    return characterSchema.parse({ ...row, assignedToUserId: assignToUserId ?? null });
  });
}

async function findSheet(
  db: DbOrTx,
  scope: CampaignScope,
  characterId: string,
  lock = false,
): Promise<{ row: CharacterRow; assignedToUserId: string | null }> {
  const query = db
    .select({ row: characters, assignedToUserId: campaignMembers.userId })
    .from(characters)
    .leftJoin(campaignMembers, holder)
    .where(scoped(scope, characterId));
  // Lock only the sheet: the member row may change hands without blocking an edit.
  const [found] = lock ? await query.for('update', { of: characters }) : await query;
  if (found === undefined) throw httpError(404, NOT_FOUND);
  return found;
}

/** The full sheet. Callers check `assertGm`. */
export async function getCharacterSheetForGm(
  db: Database,
  scope: CampaignScope,
  characterId: string,
): Promise<CharacterSheet> {
  const { row, assignedToUserId } = await findSheet(db, scope, characterId);
  return toCharacterSheet(scope, row, assignedToUserId);
}

/**
 * The caller's own PC, through the player allow-list. Any other PC, assigned or not, is
 * 404 rather than 403, so a player can't tell whether it exists.
 */
export async function getOwnCharacterSheet(
  db: Database,
  scope: CampaignScope,
  characterId: string,
): Promise<PlayerCharacterSheet> {
  const { row, assignedToUserId } = await findSheet(db, scope, characterId);
  if (assignedToUserId !== scope.userId) throw httpError(404, NOT_FOUND);
  return toPlayerCharacterSheet(toCharacterSheet(scope, row, assignedToUserId));
}

/**
 * Applies a partial update (D-23): each key sent replaces its whole value. The body is
 * validated here, inside the row lock, against the campaign's ruleset and the stored
 * sheet, so two quick edits can't together push a current value above its max. Returns
 * the Zod error for a 400 instead of throwing. Last write wins. Callers check `assertGm`
 * and `assertWritable`.
 */
export async function updateCharacterSheet(
  db: Database,
  scope: CampaignScope,
  characterId: string,
  body: unknown,
): Promise<{ sheet: CharacterSheet } | { error: ZodError }> {
  return db.transaction(async (tx) => {
    const { row: current, assignedToUserId } = await findSheet(tx, scope, characterId, true);
    const ruleset = rulesetFor(scope.campaign.rulesetVersion);
    const parsed = characterSheetPatchSchemaFor(ruleset, current).safeParse(body);
    if (!parsed.success) return { error: parsed.error };
    if (parsed.data.inventory !== undefined) {
      await requireInventoryItems(tx, scope, parsed.data.inventory);
    }

    // The patch keys are exactly the sheet's editable columns, so it can be set as is.
    const values: PgUpdateSetSource<typeof characters> = { ...parsed.data };
    const [row] = await tx
      .update(characters)
      .set(values)
      .where(scoped(scope, characterId))
      .returning();
    if (row === undefined) throw httpError(404, NOT_FOUND);
    return { sheet: toCharacterSheet(scope, row, assignedToUserId) };
  });
}

/**
 * Deletes a PC for good. Its player, if any, stays in the campaign without a PC (as when a
 * PC is unassigned, D-21). Callers check `assertGm` and `assertWritable`.
 */
export async function deleteCharacter(
  db: Database,
  scope: CampaignScope,
  characterId: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [current] = await tx
      .select({ id: characters.id })
      .from(characters)
      .where(scoped(scope, characterId))
      .for('update');
    if (current === undefined) throw httpError(404, NOT_FOUND);

    await tx
      .update(campaignMembers)
      .set({ characterId: null })
      .where(
        and(
          eq(campaignMembers.campaignId, scope.campaignId),
          eq(campaignMembers.characterId, characterId),
        ),
      );
    await tx.delete(characters).where(scoped(scope, characterId));
  });
}
