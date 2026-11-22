/**
 * A campaign's starting gear (F4.8, governance §8 "Starting gear", D-66): how the creation guide
 * hands out gear. Part of the campaign data-access layer: every query is scoped to
 * `scope.campaignId`.
 *
 * - Default: the player picks a tier 1 primary weapon (and a secondary beside a one-handed one),
 *   tier 1 armor and a potion, and gets the default items and a handful of gold.
 * - Set: every new character gets the GM's kit (19.18).
 * - None: no gear; the GM hands it out in play.
 *
 * Every member reads it (the guide needs it); only the GM changes it. It is one `starting_kits`
 * row, made on the GM's first save; until then the mode is Default. The kit is kept while
 * another mode is on. Deleting gear the kit holds clears it from the kit (as class suggestions).
 */
import { EMPTY_KIT, SUGGESTION_NOT_FIT, type StartingGear } from '@stagehand/shared';
import { and, eq } from 'drizzle-orm';

import type { Database } from '../db/client';
import { armor, startingKits, weapons } from '../db/schema';
import { httpError } from '../http/errors';

import type { DbOrTx } from './members';
import type { CampaignScope } from './scope';

const WEAPON_NOT_FOUND = 'Weapon not found';
const ARMOR_NOT_FOUND = 'Armor not found';

/** The kit's slot rules, in the GM's words. */
export const KIT_NOT_FIT = {
  primary: 'The kit’s primary weapon must be a primary weapon',
  secondary: 'The kit’s secondary weapon must be a secondary weapon',
  twoHanded: SUGGESTION_NOT_FIT.twoHanded,
} as const;

/** The campaign's starting gear: Default and an empty kit until the GM first saves it. */
export async function getStartingGear(db: DbOrTx, scope: CampaignScope): Promise<StartingGear> {
  const [row] = await db
    .select({
      mode: startingKits.mode,
      primaryWeaponId: startingKits.primaryWeaponId,
      secondaryWeaponId: startingKits.secondaryWeaponId,
      armorId: startingKits.armorId,
      items: startingKits.items,
      gold: startingKits.gold,
    })
    .from(startingKits)
    .where(eq(startingKits.campaignId, scope.campaignId));
  if (row === undefined) return { mode: 'default', kit: { ...EMPTY_KIT, items: [] } };
  const { mode, ...kit } = row;
  return { mode, kit };
}

/**
 * Saves the mode and the kit. The kit's gear must be the campaign's: a primary in the primary
 * slot, a secondary in the secondary slot, and no secondary beside a two-handed primary. Any tier
 * may be picked; the GM's page warns above tier 1. Callers check `assertGm` and `assertWritable`.
 */
export async function putStartingGear(
  db: Database,
  scope: CampaignScope,
  gear: StartingGear,
): Promise<StartingGear> {
  return db.transaction(async (tx) => {
    const { kit } = gear;
    const weapon = async (weaponId: string | null) => {
      if (weaponId === null) return null;
      const [row] = await tx
        .select({ slot: weapons.slot, burden: weapons.burden })
        .from(weapons)
        .where(and(eq(weapons.id, weaponId), eq(weapons.campaignId, scope.campaignId)));
      if (row === undefined) throw httpError(404, WEAPON_NOT_FOUND);
      return row;
    };
    const primary = await weapon(kit.primaryWeaponId);
    const secondary = await weapon(kit.secondaryWeaponId);
    if (primary !== null && primary.slot !== 'primary') throw httpError(400, KIT_NOT_FIT.primary);
    if (secondary !== null && secondary.slot !== 'secondary') {
      throw httpError(400, KIT_NOT_FIT.secondary);
    }
    if (primary?.burden === 'two_handed' && secondary !== null) {
      throw httpError(400, KIT_NOT_FIT.twoHanded);
    }
    if (kit.armorId !== null) {
      const [row] = await tx
        .select({ id: armor.id })
        .from(armor)
        .where(and(eq(armor.id, kit.armorId), eq(armor.campaignId, scope.campaignId)));
      if (row === undefined) throw httpError(404, ARMOR_NOT_FOUND);
    }

    const values = {
      mode: gear.mode,
      primaryWeaponId: kit.primaryWeaponId,
      secondaryWeaponId: kit.secondaryWeaponId,
      armorId: kit.armorId,
      items: kit.items,
      gold: kit.gold,
    };
    await tx
      .insert(startingKits)
      .values({ campaignId: scope.campaignId, ...values })
      .onConflictDoUpdate({
        target: startingKits.campaignId,
        set: { ...values, updatedAt: new Date() },
      });
    return getStartingGear(tx, scope);
  });
}

/** Takes a weapon or armor out of the kit before it is deleted. */
export async function clearFromKit(
  tx: DbOrTx,
  scope: CampaignScope,
  gear: { weaponId: string } | { armorId: string },
): Promise<void> {
  const here = eq(startingKits.campaignId, scope.campaignId);
  if ('armorId' in gear) {
    await tx
      .update(startingKits)
      .set({ armorId: null })
      .where(and(here, eq(startingKits.armorId, gear.armorId)));
    return;
  }
  await tx
    .update(startingKits)
    .set({ primaryWeaponId: null })
    .where(and(here, eq(startingKits.primaryWeaponId, gear.weaponId)));
  await tx
    .update(startingKits)
    .set({ secondaryWeaponId: null })
    .where(and(here, eq(startingKits.secondaryWeaponId, gear.weaponId)));
}
