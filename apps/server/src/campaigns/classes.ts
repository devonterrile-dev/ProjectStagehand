/**
 * Classes and subclasses (F4.5, governance §8 "Classes and subclasses", D-63). Part of the
 * campaign data-access layer: every query is scoped to `scope.campaignId`. Every member reads
 * them; callers check `assertGm` and `assertWritable` before a change.
 *
 * Checked here, since the request schemas don't know the campaign: trait ids against its ruleset,
 * domains and suggested gear against its records. Suggested gear must be tier 1 of its slot when
 * picked; gear edited afterwards is flagged in `suggestionWarnings`, not refused. Deleting a class
 * deletes its subclasses (the foreign key cascades).
 */
import {
  classRecordSchema,
  classSummarySchema,
  subclassRecordSchema,
  subclassSummarySchema,
  SUGGESTION_NOT_FIT,
  type ClassRecord,
  type ClassSummary,
  type CreateClassRequest,
  type CreateSubclassRequest,
  type GameplayRef,
  type SubclassRecord,
  type SubclassSummary,
  type UpdateClassRequest,
  type UpdateSubclassRequest,
} from '@stagehand/shared';
import { and, asc, count, eq, or, sql } from 'drizzle-orm';

import type { Database } from '../db/client';
import { armor, classes, domains, subclasses, weapons } from '../db/schema';
import { isUniqueViolation } from '../db/pg-errors';
import { httpError } from '../http/errors';

import { requireDomain } from './domain-cards';
import { ARMOR_NOT_FOUND, checkTraits, WEAPON_NOT_FOUND } from './gear';
import type { DbOrTx } from './members';
import type { CampaignScope } from './scope';

export const CLASS_NOT_FOUND = 'Class not found';
const SUBCLASS_NOT_FOUND = 'Subclass not found';
const TAKEN = 'A class with that name already exists';

type ClassRow = typeof classes.$inferSelect;
type SubclassRow = typeof subclasses.$inferSelect;
type WeaponFit = Pick<typeof weapons.$inferSelect, 'id' | 'name' | 'tier' | 'slot' | 'burden'>;
type ArmorFit = Pick<typeof armor.$inferSelect, 'id' | 'name' | 'tier'>;

function classScoped(scope: CampaignScope, classId: string) {
  return and(eq(classes.id, classId), eq(classes.campaignId, scope.campaignId));
}

function subclassScoped(scope: CampaignScope, subclassId: string) {
  return and(eq(subclasses.id, subclassId), eq(subclasses.campaignId, scope.campaignId));
}

/** The campaign's domain names by id. */
async function domainNames(db: DbOrTx, scope: CampaignScope): Promise<Map<string, string>> {
  const rows = await db
    .select({ id: domains.id, name: domains.name })
    .from(domains)
    .where(eq(domains.campaignId, scope.campaignId));
  return new Map(rows.map((row) => [row.id, row.name]));
}

function refOf(names: Map<string, string>, id: string | null): GameplayRef | null {
  if (id === null) return null;
  const name = names.get(id);
  return name === undefined ? null : { id, name };
}

function toSubclassSummary(row: SubclassRow): SubclassSummary {
  return subclassSummarySchema.parse({
    id: row.id,
    classId: row.classId,
    name: row.name,
    spellcastTrait: row.spellcastTrait,
    updatedAt: row.updatedAt.toISOString(),
  });
}

/** Why a suggested weapon or armor doesn't fit, or null when it does. */
function primaryMisfit(weapon: WeaponFit): string | null {
  return weapon.tier === 1 && weapon.slot === 'primary' ? null : SUGGESTION_NOT_FIT.primary;
}
function secondaryMisfit(weapon: WeaponFit): string | null {
  return weapon.tier === 1 && weapon.slot === 'secondary' ? null : SUGGESTION_NOT_FIT.secondary;
}
function armorMisfit(piece: ArmorFit): string | null {
  return piece.tier === 1 ? null : SUGGESTION_NOT_FIT.armor;
}

/** The suggested gear of a class, read for its record and for the fit checks. */
interface Suggestions {
  primary: WeaponFit | null;
  secondary: WeaponFit | null;
  armor: ArmorFit | null;
}

async function weaponFit(db: DbOrTx, scope: CampaignScope, id: string | null) {
  if (id === null) return null;
  const [row] = await db
    .select({
      id: weapons.id,
      name: weapons.name,
      tier: weapons.tier,
      slot: weapons.slot,
      burden: weapons.burden,
    })
    .from(weapons)
    .where(and(eq(weapons.id, id), eq(weapons.campaignId, scope.campaignId)));
  return row ?? null;
}

async function armorFit(db: DbOrTx, scope: CampaignScope, id: string | null) {
  if (id === null) return null;
  const [row] = await db
    .select({ id: armor.id, name: armor.name, tier: armor.tier })
    .from(armor)
    .where(and(eq(armor.id, id), eq(armor.campaignId, scope.campaignId)));
  return row ?? null;
}

async function suggestionsOf(
  db: DbOrTx,
  scope: CampaignScope,
  row: Pick<
    ClassRow,
    'suggestedPrimaryWeaponId' | 'suggestedSecondaryWeaponId' | 'suggestedArmorId'
  >,
): Promise<Suggestions> {
  return {
    primary: await weaponFit(db, scope, row.suggestedPrimaryWeaponId),
    secondary: await weaponFit(db, scope, row.suggestedSecondaryWeaponId),
    armor: await armorFit(db, scope, row.suggestedArmorId),
  };
}

/** Suggestions whose gear was edited since it was picked and no longer fits. */
export function suggestionWarnings(suggestions: Suggestions): string[] {
  const warnings: string[] = [];
  const { primary, secondary, armor: piece } = suggestions;
  if (primary !== null && primaryMisfit(primary) !== null) {
    warnings.push(`${primary.name} is no longer a tier 1 primary weapon`);
  }
  if (secondary !== null && secondaryMisfit(secondary) !== null) {
    warnings.push(`${secondary.name} is no longer a tier 1 secondary weapon`);
  }
  if (piece !== null && armorMisfit(piece) !== null) {
    warnings.push(`${piece.name} is no longer tier 1 armor`);
  }
  if (primary !== null && secondary !== null && primary.burden === 'two_handed') {
    warnings.push(`${primary.name} is two-handed, which leaves no hand for ${secondary.name}`);
  }
  return warnings;
}

const gearRef = (gear: { id: string; name: string } | null): GameplayRef | null =>
  gear === null ? null : { id: gear.id, name: gear.name };

async function toClass(db: DbOrTx, scope: CampaignScope, row: ClassRow): Promise<ClassRecord> {
  const names = await domainNames(db, scope);
  const suggestions = await suggestionsOf(db, scope, row);
  const subs = await db
    .select()
    .from(subclasses)
    .where(and(eq(subclasses.classId, row.id), eq(subclasses.campaignId, scope.campaignId)))
    .orderBy(asc(sql`lower(${subclasses.name})`), asc(subclasses.createdAt));
  return classRecordSchema.parse({
    id: row.id,
    name: row.name,
    domains: [refOf(names, row.domain1Id), refOf(names, row.domain2Id)],
    startingEvasion: row.startingEvasion,
    startingHp: row.startingHp,
    subclassCount: subs.length,
    updatedAt: row.updatedAt.toISOString(),
    description: row.description,
    hopeFeature: row.hopeFeature,
    classFeatures: row.classFeatures,
    suggestedTraits: row.suggestedTraits,
    suggestedPrimaryWeapon: gearRef(suggestions.primary),
    suggestedSecondaryWeapon: gearRef(suggestions.secondary),
    suggestedArmor: gearRef(suggestions.armor),
    suggestionWarnings: suggestionWarnings(suggestions),
    subclasses: subs.map(toSubclassSummary),
    createdAt: row.createdAt.toISOString(),
  });
}

// --- Classes ---

/** Every class of the campaign, by name, with its domains and how many subclasses it has. */
export async function listClasses(db: DbOrTx, scope: CampaignScope): Promise<ClassSummary[]> {
  const names = await domainNames(db, scope);
  const rows = await db
    .select({
      id: classes.id,
      name: classes.name,
      domain1Id: classes.domain1Id,
      domain2Id: classes.domain2Id,
      startingEvasion: classes.startingEvasion,
      startingHp: classes.startingHp,
      subclassCount: count(subclasses.id),
      updatedAt: classes.updatedAt,
    })
    .from(classes)
    .leftJoin(
      subclasses,
      and(eq(subclasses.classId, classes.id), eq(subclasses.campaignId, classes.campaignId)),
    )
    .where(eq(classes.campaignId, scope.campaignId))
    .groupBy(classes.id)
    .orderBy(asc(sql`lower(${classes.name})`), asc(classes.createdAt));
  return rows.map((row) =>
    classSummarySchema.parse({
      id: row.id,
      name: row.name,
      domains: [refOf(names, row.domain1Id), refOf(names, row.domain2Id)],
      startingEvasion: row.startingEvasion,
      startingHp: row.startingHp,
      subclassCount: row.subclassCount,
      updatedAt: row.updatedAt.toISOString(),
    }),
  );
}

export async function getClass(
  db: DbOrTx,
  scope: CampaignScope,
  classId: string,
): Promise<ClassRecord> {
  const [row] = await db.select().from(classes).where(classScoped(scope, classId));
  if (row === undefined) throw httpError(404, CLASS_NOT_FOUND);
  return toClass(db, scope, row);
}

/** Runs a write that may give a class a name it already has: 409 in our words if so. */
async function namedOnce<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (error) {
    if (isUniqueViolation(error)) throw httpError(409, TAKEN);
    throw error;
  }
}

export async function createClass(
  db: Database,
  scope: CampaignScope,
  request: CreateClassRequest,
): Promise<ClassRecord> {
  const [row] = await namedOnce(() =>
    db.insert(classes).values({ campaignId: scope.campaignId, name: request.name }).returning(),
  );
  if (row === undefined) throw new Error('class insert returned no row');
  return toClass(db, scope, row);
}

/**
 * The suggested gear after a patch, refused when a newly picked piece is missing (404) or doesn't
 * fit (400). The two-handed rule is checked whenever the patch picks either weapon.
 */
async function checkSuggestions(
  tx: DbOrTx,
  scope: CampaignScope,
  current: ClassRow,
  patch: UpdateClassRequest,
): Promise<void> {
  const picked = async (id: string | null | undefined) => {
    if (id === undefined || id === null) return null;
    const weapon = await weaponFit(tx, scope, id);
    if (weapon === null) throw httpError(404, WEAPON_NOT_FOUND);
    return weapon;
  };
  const primary = await picked(patch.suggestedPrimaryWeaponId);
  if (primary !== null && primaryMisfit(primary) !== null) {
    throw httpError(400, SUGGESTION_NOT_FIT.primary);
  }
  const secondary = await picked(patch.suggestedSecondaryWeaponId);
  if (secondary !== null && secondaryMisfit(secondary) !== null) {
    throw httpError(400, SUGGESTION_NOT_FIT.secondary);
  }
  if (patch.suggestedArmorId !== undefined && patch.suggestedArmorId !== null) {
    const piece = await armorFit(tx, scope, patch.suggestedArmorId);
    if (piece === null) throw httpError(404, ARMOR_NOT_FOUND);
    if (armorMisfit(piece) !== null) throw httpError(400, SUGGESTION_NOT_FIT.armor);
  }

  if (
    patch.suggestedPrimaryWeaponId === undefined &&
    patch.suggestedSecondaryWeaponId === undefined
  ) {
    return;
  }
  const finalPrimary =
    patch.suggestedPrimaryWeaponId === undefined
      ? await weaponFit(tx, scope, current.suggestedPrimaryWeaponId)
      : primary;
  const finalSecondaryId =
    patch.suggestedSecondaryWeaponId === undefined
      ? current.suggestedSecondaryWeaponId
      : patch.suggestedSecondaryWeaponId;
  if (finalPrimary?.burden === 'two_handed' && finalSecondaryId !== null) {
    throw httpError(400, SUGGESTION_NOT_FIT.twoHanded);
  }
}

/** Applies a partial update. Last write wins. */
export async function updateClass(
  db: Database,
  scope: CampaignScope,
  classId: string,
  patch: UpdateClassRequest,
): Promise<ClassRecord> {
  if (patch.suggestedTraits !== undefined) checkTraits(scope, Object.keys(patch.suggestedTraits));
  return namedOnce(() =>
    db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(classes)
        .where(classScoped(scope, classId))
        .for('update');
      if (current === undefined) throw httpError(404, CLASS_NOT_FOUND);

      const { domainIds, ...rest } = patch;
      const values: Partial<typeof classes.$inferInsert> = { ...rest };
      if (domainIds !== undefined) {
        for (const id of domainIds) if (id !== null) await requireDomain(tx, scope, id);
        values.domain1Id = domainIds[0];
        values.domain2Id = domainIds[1];
      }
      await checkSuggestions(tx, scope, current, patch);

      const [row] = await tx
        .update(classes)
        .set(values)
        .where(classScoped(scope, classId))
        .returning();
      if (row === undefined) throw httpError(404, CLASS_NOT_FOUND);
      return toClass(tx, scope, row);
    }),
  );
}

/** Deletes a class and, through the foreign key, its subclasses. */
export async function deleteClass(
  db: Database,
  scope: CampaignScope,
  classId: string,
): Promise<void> {
  const removed = await db
    .delete(classes)
    .where(classScoped(scope, classId))
    .returning({ id: classes.id });
  if (removed.length === 0) throw httpError(404, CLASS_NOT_FOUND);
}

/** The names of the classes using a domain, by name: they keep it from being deleted. */
export async function classesUsingDomain(
  db: DbOrTx,
  scope: CampaignScope,
  domainId: string,
): Promise<string[]> {
  const rows = await db
    .select({ name: classes.name })
    .from(classes)
    .where(
      and(
        eq(classes.campaignId, scope.campaignId),
        or(eq(classes.domain1Id, domainId), eq(classes.domain2Id, domainId)),
      ),
    )
    .orderBy(asc(sql`lower(${classes.name})`));
  return rows.map((row) => row.name);
}

/** Clears every class suggestion of a weapon or armor about to be deleted. */
export async function clearSuggestionsOf(
  tx: DbOrTx,
  scope: CampaignScope,
  gear: { weaponId: string } | { armorId: string },
): Promise<void> {
  const inCampaign = eq(classes.campaignId, scope.campaignId);
  if ('armorId' in gear) {
    await tx
      .update(classes)
      .set({ suggestedArmorId: null })
      .where(and(inCampaign, eq(classes.suggestedArmorId, gear.armorId)));
    return;
  }
  await tx
    .update(classes)
    .set({ suggestedPrimaryWeaponId: null })
    .where(and(inCampaign, eq(classes.suggestedPrimaryWeaponId, gear.weaponId)));
  await tx
    .update(classes)
    .set({ suggestedSecondaryWeaponId: null })
    .where(and(inCampaign, eq(classes.suggestedSecondaryWeaponId, gear.weaponId)));
}

// --- Subclasses ---

async function toSubclass(
  db: DbOrTx,
  scope: CampaignScope,
  row: SubclassRow,
): Promise<SubclassRecord> {
  const [owner] = await db
    .select({ name: classes.name })
    .from(classes)
    .where(classScoped(scope, row.classId));
  return subclassRecordSchema.parse({
    ...toSubclassSummary(row),
    className: owner?.name ?? '',
    description: row.description,
    foundation: row.foundation,
    specialization: row.specialization,
    mastery: row.mastery,
    createdAt: row.createdAt.toISOString(),
  });
}

/** Every subclass of the campaign: by class name, then name. */
export async function listSubclasses(db: DbOrTx, scope: CampaignScope): Promise<SubclassSummary[]> {
  const rows = await db
    .select({ subclass: subclasses })
    .from(subclasses)
    .innerJoin(
      classes,
      and(eq(classes.id, subclasses.classId), eq(classes.campaignId, subclasses.campaignId)),
    )
    .where(eq(subclasses.campaignId, scope.campaignId))
    .orderBy(
      asc(sql`lower(${classes.name})`),
      asc(sql`lower(${subclasses.name})`),
      asc(subclasses.createdAt),
    );
  return rows.map((row) => toSubclassSummary(row.subclass));
}

export async function getSubclass(
  db: DbOrTx,
  scope: CampaignScope,
  subclassId: string,
): Promise<SubclassRecord> {
  const [row] = await db.select().from(subclasses).where(subclassScoped(scope, subclassId));
  if (row === undefined) throw httpError(404, SUBCLASS_NOT_FOUND);
  return toSubclass(db, scope, row);
}

/** Creates a subclass in one of the campaign's classes. */
export async function createSubclass(
  db: Database,
  scope: CampaignScope,
  request: CreateSubclassRequest,
): Promise<SubclassRecord> {
  return db.transaction(async (tx) => {
    const [owner] = await tx
      .select({ id: classes.id })
      .from(classes)
      .where(classScoped(scope, request.classId));
    if (owner === undefined) throw httpError(404, CLASS_NOT_FOUND);
    const [row] = await tx
      .insert(subclasses)
      .values({ campaignId: scope.campaignId, classId: request.classId, name: request.name })
      .returning();
    if (row === undefined) throw new Error('subclass insert returned no row');
    return toSubclass(tx, scope, row);
  });
}

/** Applies a partial update. Last write wins. */
export async function updateSubclass(
  db: Database,
  scope: CampaignScope,
  subclassId: string,
  patch: UpdateSubclassRequest,
): Promise<SubclassRecord> {
  if (patch.spellcastTrait !== undefined && patch.spellcastTrait !== null) {
    checkTraits(scope, [patch.spellcastTrait]);
  }
  const [row] = await db
    .update(subclasses)
    .set(patch)
    .where(subclassScoped(scope, subclassId))
    .returning();
  if (row === undefined) throw httpError(404, SUBCLASS_NOT_FOUND);
  return toSubclass(db, scope, row);
}

export async function deleteSubclass(
  db: Database,
  scope: CampaignScope,
  subclassId: string,
): Promise<void> {
  const removed = await db
    .delete(subclasses)
    .where(subclassScoped(scope, subclassId))
    .returning({ id: subclasses.id });
  if (removed.length === 0) throw httpError(404, SUBCLASS_NOT_FOUND);
}
