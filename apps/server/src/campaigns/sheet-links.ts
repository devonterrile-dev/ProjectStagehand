/**
 * A sheet's links to gameplay records (F4.7, governance §8 "Character sheet", D-65). Part of the
 * campaign data-access layer: every query is scoped to `scope.campaignId`.
 *
 * - `loadSheetRecords` reads the records a sheet links, for `buildSheet`.
 * - `applyLinkPatch` checks the link keys of a GM's sheet edit and turns them into columns and
 *   spare-weapon rows: every record must be the campaign's, a subclass of the linked class, a
 *   primary weapon a primary and a secondary a secondary, with no secondary beside a two-handed
 *   primary. Changing the class drops a subclass of another class.
 * - `sheetsUsing` names the PCs whose sheets use a record, which keeps it from being deleted.
 */
import {
  effectiveTraits,
  equippedBonuses,
  SUGGESTION_NOT_FIT,
  type Ruleset,
  type CharacterSheetPatch,
  type SheetLinks,
  type SheetRecords,
} from '@stagehand/shared';
import { and, asc, eq, inArray, or, sql } from 'drizzle-orm';

import {
  armor,
  characterDomainCards,
  characters,
  characterWeapons,
  classes,
  domainCards,
  domains,
  species,
  subclasses,
  weapons,
} from '../db/schema';
import { httpError } from '../http/errors';

import { CLASS_NOT_FOUND } from './classes';
import { domainJoin, toCard, withDomain } from './domain-cards';
import { ARMOR_NOT_FOUND, toArmor, toWeapon, WEAPON_NOT_FOUND } from './gear';
import type { DbOrTx } from './members';
import { sheetsOf } from './names';
import type { CampaignScope } from './scope';

type CharacterRow = typeof characters.$inferSelect;

const SUBCLASS_NOT_FOUND = 'Subclass not found';
const SPECIES_NOT_FOUND = 'Species not found';
export const SUBCLASS_OF_CLASS = "Pick a subclass of the PC's class";
export const NOT_A_PRIMARY = 'Pick a primary weapon for the primary slot';
export const NOT_A_SECONDARY = 'Pick a secondary weapon for the secondary slot';

/** The link ids a sheet row holds. */
export function linksOf(row: CharacterRow, spareWeaponIds: readonly string[]): SheetLinks {
  return {
    classId: row.classId,
    subclassId: row.subclassId,
    subclassCards: row.subclassCards,
    speciesIds: [row.species1Id, row.species2Id],
    primaryWeaponId: row.primaryWeaponId,
    secondaryWeaponId: row.secondaryWeaponId,
    armorId: row.armorId,
    spareWeaponIds: [...spareWeaponIds],
  };
}

const inCampaign = (scope: CampaignScope) => eq(weapons.campaignId, scope.campaignId);

async function weaponById(db: DbOrTx, scope: CampaignScope, id: string | null) {
  if (id === null) return null;
  const [row] = await db
    .select()
    .from(weapons)
    .where(and(eq(weapons.id, id), inCampaign(scope)));
  return row === undefined ? null : toWeapon(row);
}

async function speciesById(db: DbOrTx, scope: CampaignScope, id: string | null) {
  if (id === null) return null;
  const [row] = await db
    .select({ id: species.id, name: species.name, features: species.features })
    .from(species)
    .where(and(eq(species.id, id), eq(species.campaignId, scope.campaignId)));
  return row ?? null;
}

/** The spare weapons a sheet links, in order. */
async function spareRows(db: DbOrTx, scope: CampaignScope, characterId: string) {
  return db
    .select({ weapon: weapons })
    .from(characterWeapons)
    .innerJoin(
      weapons,
      and(
        eq(weapons.id, characterWeapons.weaponId),
        eq(weapons.campaignId, characterWeapons.campaignId),
      ),
    )
    .where(
      and(
        eq(characterWeapons.characterId, characterId),
        eq(characterWeapons.campaignId, scope.campaignId),
      ),
    )
    .orderBy(asc(characterWeapons.position));
}

/** Everything a sheet links, read for `buildSheet`, with its link ids. */
export async function loadSheetRecords(
  db: DbOrTx,
  scope: CampaignScope,
  row: CharacterRow,
): Promise<{ links: SheetLinks; records: SheetRecords }> {
  let linkedClass: SheetRecords['class'] = null;
  if (row.classId !== null) {
    const [found] = await db
      .select()
      .from(classes)
      .where(and(eq(classes.id, row.classId), eq(classes.campaignId, scope.campaignId)));
    if (found !== undefined) {
      linkedClass = {
        id: found.id,
        name: found.name,
        domainIds: [found.domain1Id, found.domain2Id],
        hopeFeature: found.hopeFeature,
        classFeatures: found.classFeatures,
      };
    }
  }

  let linkedSubclass: SheetRecords['subclass'] = null;
  if (row.subclassId !== null) {
    const [found] = await db
      .select({ sub: subclasses, className: classes.name })
      .from(subclasses)
      .innerJoin(
        classes,
        and(eq(classes.id, subclasses.classId), eq(classes.campaignId, subclasses.campaignId)),
      )
      .where(and(eq(subclasses.id, row.subclassId), eq(subclasses.campaignId, scope.campaignId)));
    if (found !== undefined) {
      linkedSubclass = {
        id: found.sub.id,
        name: found.sub.name,
        className: found.className,
        spellcastTrait: found.sub.spellcastTrait,
        foundation: found.sub.foundation,
        specialization: found.sub.specialization,
        mastery: found.sub.mastery,
      };
    }
  }

  let linkedArmor: SheetRecords['armor'] = null;
  if (row.armorId !== null) {
    const [found] = await db
      .select()
      .from(armor)
      .where(and(eq(armor.id, row.armorId), eq(armor.campaignId, scope.campaignId)));
    if (found !== undefined) linkedArmor = toArmor(found);
  }

  const spares = await spareRows(db, scope, row.id);

  const held = await db
    .select({
      ...withDomain,
      place: characterDomainCards.place,
      at: characterDomainCards.takenAtLevel,
    })
    .from(characterDomainCards)
    .innerJoin(
      domainCards,
      and(
        eq(domainCards.id, characterDomainCards.cardId),
        eq(domainCards.campaignId, characterDomainCards.campaignId),
      ),
    )
    .innerJoin(domains, domainJoin)
    .where(
      and(
        eq(characterDomainCards.characterId, row.id),
        eq(characterDomainCards.campaignId, scope.campaignId),
      ),
    );

  return {
    links: linksOf(
      row,
      spares.map((spare) => spare.weapon.id),
    ),
    records: {
      class: linkedClass,
      subclass: linkedSubclass,
      species: [
        await speciesById(db, scope, row.species1Id),
        await speciesById(db, scope, row.species2Id),
      ],
      primary: await weaponById(db, scope, row.primaryWeaponId),
      secondary: await weaponById(db, scope, row.secondaryWeaponId),
      armor: linkedArmor,
      spares: spares.map((spare) => toWeapon(spare.weapon)),
      cards: held.map((entry) => ({
        card: toCard(entry.card, entry.domainName),
        place: entry.place,
        takenAtLevel: entry.at,
      })),
    },
  };
}

/**
 * A PC's traits with the bonuses of their equipped gear (19.25): what a called roll adds. Gear
 * of the typed sheet adds nothing.
 */
export async function effectiveTraitsOf(
  db: DbOrTx,
  scope: CampaignScope,
  pc: Pick<CharacterRow, 'traits' | 'primaryWeaponId' | 'secondaryWeaponId' | 'armorId'>,
  ruleset: Ruleset,
): Promise<Record<string, number>> {
  let worn = null;
  if (pc.armorId !== null) {
    const [found] = await db
      .select({ bonuses: armor.bonuses })
      .from(armor)
      .where(and(eq(armor.id, pc.armorId), eq(armor.campaignId, scope.campaignId)));
    worn = found ?? null;
  }
  const bonuses = equippedBonuses([
    await weaponById(db, scope, pc.primaryWeaponId),
    await weaponById(db, scope, pc.secondaryWeaponId),
    worn,
  ]);
  return effectiveTraits(pc.traits, bonuses, ruleset);
}

/** The columns a patch's link keys set, and the spare weapons when they change. */
export interface LinkChanges {
  columns: Partial<
    Pick<
      CharacterRow,
      | 'classId'
      | 'subclassId'
      | 'subclassCards'
      | 'species1Id'
      | 'species2Id'
      | 'primaryWeaponId'
      | 'secondaryWeaponId'
      | 'armorId'
    >
  >;
  spareWeaponIds?: readonly string[];
}

/**
 * Checks a patch's link keys against the campaign's records and the sheet as it stands, inside
 * the caller's transaction (the sheet row is locked).
 */
export async function checkLinkPatch(
  tx: DbOrTx,
  scope: CampaignScope,
  current: CharacterRow,
  patch: CharacterSheetPatch,
): Promise<LinkChanges> {
  const columns: LinkChanges['columns'] = {};

  if (patch.classId !== undefined) {
    if (patch.classId !== null) {
      const [found] = await tx
        .select({ id: classes.id })
        .from(classes)
        .where(and(eq(classes.id, patch.classId), eq(classes.campaignId, scope.campaignId)));
      if (found === undefined) throw httpError(404, CLASS_NOT_FOUND);
    }
    columns.classId = patch.classId;
  }
  const classId = patch.classId === undefined ? current.classId : patch.classId;

  let subclassId = patch.subclassId === undefined ? current.subclassId : patch.subclassId;
  if (subclassId !== null) {
    const [found] = await tx
      .select({ classId: subclasses.classId })
      .from(subclasses)
      .where(and(eq(subclasses.id, subclassId), eq(subclasses.campaignId, scope.campaignId)));
    if (found === undefined) throw httpError(404, SUBCLASS_NOT_FOUND);
    if (found.classId !== classId) {
      // A new class drops a subclass of the old one; a subclass sent with it must fit.
      if (patch.subclassId !== undefined) throw httpError(400, SUBCLASS_OF_CLASS);
      subclassId = null;
    }
  }
  if (subclassId !== current.subclassId || patch.subclassId !== undefined) {
    columns.subclassId = subclassId;
  }
  if (patch.subclassCards !== undefined) columns.subclassCards = patch.subclassCards;

  if (patch.speciesIds !== undefined) {
    for (const id of patch.speciesIds) {
      if (id !== null && (await speciesById(tx, scope, id)) === null) {
        throw httpError(404, SPECIES_NOT_FOUND);
      }
    }
    [columns.species1Id, columns.species2Id] = patch.speciesIds;
  }

  const pick = async (id: string | null | undefined) => {
    if (id === undefined || id === null) return null;
    const weapon = await weaponById(tx, scope, id);
    if (weapon === null) throw httpError(404, WEAPON_NOT_FOUND);
    return weapon;
  };
  const primary = await pick(patch.primaryWeaponId);
  if (primary !== null && primary.slot !== 'primary') throw httpError(400, NOT_A_PRIMARY);
  const secondary = await pick(patch.secondaryWeaponId);
  if (secondary !== null && secondary.slot !== 'secondary') throw httpError(400, NOT_A_SECONDARY);
  if (patch.primaryWeaponId !== undefined) columns.primaryWeaponId = patch.primaryWeaponId;
  if (patch.secondaryWeaponId !== undefined) columns.secondaryWeaponId = patch.secondaryWeaponId;
  if (patch.primaryWeaponId !== undefined || patch.secondaryWeaponId !== undefined) {
    const finalPrimary =
      patch.primaryWeaponId === undefined
        ? await weaponById(tx, scope, current.primaryWeaponId)
        : primary;
    const secondaryId =
      patch.secondaryWeaponId === undefined ? current.secondaryWeaponId : patch.secondaryWeaponId;
    if (finalPrimary?.burden === 'two_handed' && secondaryId !== null) {
      throw httpError(400, SUGGESTION_NOT_FIT.twoHanded);
    }
  }

  if (patch.armorId !== undefined) {
    if (patch.armorId !== null) {
      const [found] = await tx
        .select({ id: armor.id })
        .from(armor)
        .where(and(eq(armor.id, patch.armorId), eq(armor.campaignId, scope.campaignId)));
      if (found === undefined) throw httpError(404, ARMOR_NOT_FOUND);
    }
    columns.armorId = patch.armorId;
  }

  if (patch.spareWeaponIds === undefined) return { columns };
  const distinct = [...new Set(patch.spareWeaponIds)];
  if (distinct.length > 0) {
    const found = await tx
      .select({ id: weapons.id })
      .from(weapons)
      .where(and(inArray(weapons.id, distinct), inCampaign(scope)));
    if (found.length !== distinct.length) throw httpError(404, WEAPON_NOT_FOUND);
  }
  return { columns, spareWeaponIds: patch.spareWeaponIds };
}

/** Replaces a sheet's linked spare weapons. */
export async function saveSpares(
  tx: DbOrTx,
  scope: CampaignScope,
  characterId: string,
  weaponIds: readonly string[],
): Promise<void> {
  await tx
    .delete(characterWeapons)
    .where(
      and(
        eq(characterWeapons.characterId, characterId),
        eq(characterWeapons.campaignId, scope.campaignId),
      ),
    );
  if (weaponIds.length === 0) return;
  await tx.insert(characterWeapons).values(
    weaponIds.map((weaponId, position) => ({
      characterId,
      campaignId: scope.campaignId,
      position,
      weaponId,
    })),
  );
}

/** A gameplay record a sheet may use. */
export type SheetUse =
  | { classId: string }
  | { subclassIds: readonly string[] }
  | { speciesId: string }
  | { weaponId: string }
  | { armorId: string }
  | { cardId: string };

/** The names of the PCs whose sheets use a record, by name. */
export async function sheetsUsing(
  db: DbOrTx,
  scope: CampaignScope,
  use: SheetUse,
): Promise<string[]> {
  const mine = eq(characters.campaignId, scope.campaignId);
  let where;
  if ('classId' in use) where = eq(characters.classId, use.classId);
  else if ('subclassIds' in use) {
    if (use.subclassIds.length === 0) return [];
    where = inArray(characters.subclassId, [...use.subclassIds]);
  } else if ('speciesId' in use) {
    where = or(eq(characters.species1Id, use.speciesId), eq(characters.species2Id, use.speciesId));
  } else if ('armorId' in use) where = eq(characters.armorId, use.armorId);
  else if ('weaponId' in use) {
    const spare = db
      .select({ id: characterWeapons.characterId })
      .from(characterWeapons)
      .where(
        and(
          eq(characterWeapons.weaponId, use.weaponId),
          eq(characterWeapons.campaignId, scope.campaignId),
        ),
      );
    where = or(
      eq(characters.primaryWeaponId, use.weaponId),
      eq(characters.secondaryWeaponId, use.weaponId),
      inArray(characters.id, spare),
    );
  } else {
    const holders = db
      .select({ id: characterDomainCards.characterId })
      .from(characterDomainCards)
      .where(
        and(
          eq(characterDomainCards.cardId, use.cardId),
          eq(characterDomainCards.campaignId, scope.campaignId),
        ),
      );
    where = inArray(characters.id, holders);
  }
  const rows = await db
    .select({ name: characters.name })
    .from(characters)
    .where(and(mine, where))
    .orderBy(asc(sql`lower(${characters.name})`));
  return rows.map((row) => row.name);
}

/** 409 while sheets use a record: "Used by Vex's sheet. Unlink it there first." */
export function refuseWhileUsed(names: readonly string[]): void {
  if (names.length > 0) {
    throw httpError(409, `Used by ${sheetsOf(names)}. Unlink it there first.`);
  }
}
