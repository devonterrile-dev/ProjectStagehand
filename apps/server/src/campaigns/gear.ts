/**
 * Weapons and armor (F4.4, governance §8 "Weapons and armor", D-62). Part of the campaign
 * data-access layer: every query is scoped to `scope.campaignId`. Every member reads them;
 * callers check `assertGm` and `assertWritable` before a change. Deleting gear a class suggests
 * clears the suggestion (F4.5); sheets equipping it will keep it from being deleted (F4.7).
 *
 * Trait ids (a weapon's trait, and the keys of a bonus to traits) are checked here against the
 * campaign's ruleset, since the request schemas don't know it.
 */
import {
  armorRecordSchema,
  rulesetFor,
  SECONDARY_ONE_HANDED,
  traitIdsOf,
  weaponRecordSchema,
  type ArmorRecord,
  type CreateArmorRequest,
  type CreateWeaponRequest,
  type GearBonuses,
  type UpdateArmorRequest,
  type UpdateWeaponRequest,
  type WeaponRecord,
} from '@stagehand/shared';
import { and, asc, eq, sql } from 'drizzle-orm';

import type { Database } from '../db/client';
import { armor, weapons } from '../db/schema';
import { httpError } from '../http/errors';

import { clearSuggestionsOf } from './classes';
import type { DbOrTx } from './members';
import type { CampaignScope } from './scope';

export const WEAPON_NOT_FOUND = 'Weapon not found';
export const ARMOR_NOT_FOUND = 'Armor not found';

/** 400 unless every id is a trait of the campaign's ruleset. */
export function checkTraits(scope: CampaignScope, ids: Iterable<string>): void {
  const known = new Set(traitIdsOf(rulesetFor(scope.campaign.rulesetVersion)));
  for (const id of ids) {
    if (!known.has(id)) throw httpError(400, `Unknown trait: ${id}`);
  }
}

function checkBonuses(scope: CampaignScope, bonuses: GearBonuses | undefined): void {
  if (bonuses !== undefined) checkTraits(scope, Object.keys(bonuses.traits));
}

type WeaponRow = typeof weapons.$inferSelect;
type ArmorRow = typeof armor.$inferSelect;

function toWeapon(row: WeaponRow): WeaponRecord {
  return weaponRecordSchema.parse({
    id: row.id,
    tier: row.tier,
    name: row.name,
    slot: row.slot,
    kind: row.kind,
    trait: row.trait,
    range: row.range,
    damageDie: row.damageDie,
    damageBonus: row.damageBonus,
    burden: row.burden,
    featureName: row.featureName,
    featureText: row.featureText,
    bonuses: row.bonuses,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}

function toArmor(row: ArmorRow): ArmorRecord {
  return armorRecordSchema.parse({
    id: row.id,
    tier: row.tier,
    name: row.name,
    baseMajorThreshold: row.baseMajorThreshold,
    baseSevereThreshold: row.baseSevereThreshold,
    baseScore: row.baseScore,
    featureName: row.featureName,
    featureText: row.featureText,
    bonuses: row.bonuses,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}

function weaponScoped(scope: CampaignScope, weaponId: string) {
  return and(eq(weapons.id, weaponId), eq(weapons.campaignId, scope.campaignId));
}

function armorScoped(scope: CampaignScope, armorId: string) {
  return and(eq(armor.id, armorId), eq(armor.campaignId, scope.campaignId));
}

// --- Weapons ---

/** The campaign's weapons: by tier, primary before secondary, then name. */
export async function listWeapons(db: DbOrTx, scope: CampaignScope): Promise<WeaponRecord[]> {
  const rows = await db
    .select()
    .from(weapons)
    .where(eq(weapons.campaignId, scope.campaignId))
    .orderBy(
      asc(weapons.tier),
      asc(weapons.slot),
      asc(sql`lower(${weapons.name})`),
      asc(weapons.createdAt),
    );
  return rows.map(toWeapon);
}

export async function getWeapon(
  db: DbOrTx,
  scope: CampaignScope,
  weaponId: string,
): Promise<WeaponRecord> {
  const [row] = await db.select().from(weapons).where(weaponScoped(scope, weaponId));
  if (row === undefined) throw httpError(404, WEAPON_NOT_FOUND);
  return toWeapon(row);
}

/** Creates a weapon. Its trait starts as the ruleset's first. */
export async function createWeapon(
  db: Database,
  scope: CampaignScope,
  request: CreateWeaponRequest,
): Promise<WeaponRecord> {
  const ruleset = rulesetFor(scope.campaign.rulesetVersion);
  const trait = request.trait ?? ruleset.traits[0]?.id;
  if (trait === undefined) throw new Error('ruleset has no traits');
  checkTraits(scope, [trait]);
  checkBonuses(scope, request.bonuses);
  if (request.slot === 'secondary' && request.burden === 'two_handed') {
    throw httpError(400, SECONDARY_ONE_HANDED);
  }
  const [row] = await db
    .insert(weapons)
    .values({ ...request, campaignId: scope.campaignId, trait })
    .returning();
  if (row === undefined) throw new Error('weapon insert returned no row');
  return toWeapon(row);
}

/**
 * Applies a partial update. Making a weapon secondary makes it one-handed too, and a two-handed
 * secondary is refused. Last write wins.
 */
export async function updateWeapon(
  db: Database,
  scope: CampaignScope,
  weaponId: string,
  patch: UpdateWeaponRequest,
): Promise<WeaponRecord> {
  if (patch.trait !== undefined) checkTraits(scope, [patch.trait]);
  checkBonuses(scope, patch.bonuses);
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select({ slot: weapons.slot, burden: weapons.burden })
      .from(weapons)
      .where(weaponScoped(scope, weaponId))
      .for('update');
    if (current === undefined) throw httpError(404, WEAPON_NOT_FOUND);
    const slot = patch.slot ?? current.slot;
    const burden = patch.burden ?? (patch.slot === 'secondary' ? 'one_handed' : current.burden);
    if (slot === 'secondary' && burden === 'two_handed') {
      throw httpError(400, SECONDARY_ONE_HANDED);
    }
    const [row] = await tx
      .update(weapons)
      .set({ ...patch, burden })
      .where(weaponScoped(scope, weaponId))
      .returning();
    if (row === undefined) throw httpError(404, WEAPON_NOT_FOUND);
    return toWeapon(row);
  });
}

export async function deleteWeapon(
  db: Database,
  scope: CampaignScope,
  weaponId: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    await clearSuggestionsOf(tx, scope, { weaponId });
    const removed = await tx
      .delete(weapons)
      .where(weaponScoped(scope, weaponId))
      .returning({ id: weapons.id });
    if (removed.length === 0) throw httpError(404, WEAPON_NOT_FOUND);
  });
}

// --- Armor ---

/** The campaign's armor: by tier, then name. */
export async function listArmor(db: DbOrTx, scope: CampaignScope): Promise<ArmorRecord[]> {
  const rows = await db
    .select()
    .from(armor)
    .where(eq(armor.campaignId, scope.campaignId))
    .orderBy(asc(armor.tier), asc(sql`lower(${armor.name})`), asc(armor.createdAt));
  return rows.map(toArmor);
}

export async function getArmor(
  db: DbOrTx,
  scope: CampaignScope,
  armorId: string,
): Promise<ArmorRecord> {
  const [row] = await db.select().from(armor).where(armorScoped(scope, armorId));
  if (row === undefined) throw httpError(404, ARMOR_NOT_FOUND);
  return toArmor(row);
}

export async function createArmor(
  db: Database,
  scope: CampaignScope,
  request: CreateArmorRequest,
): Promise<ArmorRecord> {
  checkBonuses(scope, request.bonuses);
  const [row] = await db
    .insert(armor)
    .values({ ...request, campaignId: scope.campaignId })
    .returning();
  if (row === undefined) throw new Error('armor insert returned no row');
  return toArmor(row);
}

/** Applies a partial update. Last write wins. */
export async function updateArmor(
  db: Database,
  scope: CampaignScope,
  armorId: string,
  patch: UpdateArmorRequest,
): Promise<ArmorRecord> {
  checkBonuses(scope, patch.bonuses);
  const [row] = await db.update(armor).set(patch).where(armorScoped(scope, armorId)).returning();
  if (row === undefined) throw httpError(404, ARMOR_NOT_FOUND);
  return toArmor(row);
}

export async function deleteArmor(
  db: Database,
  scope: CampaignScope,
  armorId: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    await clearSuggestionsOf(tx, scope, { armorId });
    const removed = await tx
      .delete(armor)
      .where(armorScoped(scope, armorId))
      .returning({ id: armor.id });
    if (removed.length === 0) throw httpError(404, ARMOR_NOT_FOUND);
  });
}
