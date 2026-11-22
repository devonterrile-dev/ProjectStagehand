/**
 * The character creation guide's Finish (F4.8, governance §9 "Character creation", D-66). Part of
 * the campaign data-access layer: every query is scoped to `scope.campaignId`.
 *
 * A PC waiting for the guide (`needs_guide`) is built by its own player, or by the GM for them,
 * from everything the guide picked, checked here again: a class and one of its subclasses, one
 * species or two for a mixed ancestry, traits that are the ruleset's creation spread, the
 * starting gear the campaign's mode allows, and two level-1 cards from the class's domains.
 * Then, in one transaction under the PC's row lock, the sheet becomes a level-1 character:
 *
 * - links to the class (holding the foundation), species, and the weapons and armor;
 * - level 1, the starting proficiency, the class's evasion and HP (full), the ruleset's Stress
 *   slots with none marked and starting Hope, no Hope bonus, no armor slots marked;
 * - the typed class name, weapons in hand, armor and class feature cleared, so the links show;
 * - the starting items and gold added to what the sheet already carries;
 * - its domain cards replaced by the two picks, in the loadout;
 * - `needs_guide` off and `built_at` now.
 *
 * Experiences, combat options, spare weapons, typed spares and the GM's notes stay.
 */
import {
  BUILD_MESSAGES,
  creationCardProblem,
  defaultGearProblem,
  startingItems,
  traitsProblem,
  rulesetFor,
  type BuildCharacterRequest,
  type InventoryItem,
} from '@stagehand/shared';
import { and, eq, inArray } from 'drizzle-orm';

import type { Database } from '../db/client';
import {
  armor,
  characterDomainCards,
  characters,
  classes,
  domainCards,
  species,
  subclasses,
  weapons,
} from '../db/schema';
import { httpError } from '../http/errors';

import { findSheet } from './characters';
import type { DbOrTx } from './members';
import type { CampaignScope } from './scope';
import { getStartingGear } from './starting-gear';

const NOT_FOUND = 'Character not found';

async function weaponOf(tx: DbOrTx, scope: CampaignScope, weaponId: string | null) {
  if (weaponId === null) return null;
  const [row] = await tx
    .select({ id: weapons.id, slot: weapons.slot, tier: weapons.tier, burden: weapons.burden })
    .from(weapons)
    .where(and(eq(weapons.id, weaponId), eq(weapons.campaignId, scope.campaignId)));
  if (row === undefined) throw httpError(404, 'Weapon not found');
  return row;
}

async function armorOf(tx: DbOrTx, scope: CampaignScope, armorId: string | null) {
  if (armorId === null) return null;
  const [row] = await tx
    .select({ id: armor.id, tier: armor.tier })
    .from(armor)
    .where(and(eq(armor.id, armorId), eq(armor.campaignId, scope.campaignId)));
  if (row === undefined) throw httpError(404, 'Armor not found');
  return row;
}

/**
 * Builds the PC from the guide's picks. Returns who holds it, for the caller's view. Callers check
 * `assertWritable`; the PC's own player or the GM may build it, anyone else gets 404.
 */
export async function buildCharacter(
  db: Database,
  scope: CampaignScope,
  characterId: string,
  request: BuildCharacterRequest,
): Promise<void> {
  const ruleset = rulesetFor(scope.campaign.rulesetVersion);
  const { start, proficiency, domainCards: cardRules } = ruleset;
  if (start === undefined || proficiency === undefined || cardRules === undefined) {
    throw httpError(400, BUILD_MESSAGES.noRuleset);
  }

  await db.transaction(async (tx) => {
    const { row, assignedToUserId } = await findSheet(tx, scope, characterId, true);
    if (scope.role !== 'gm' && assignedToUserId !== scope.userId) {
      throw httpError(404, NOT_FOUND);
    }
    if (!row.needsGuide) throw httpError(409, BUILD_MESSAGES.alreadyBuilt);

    // The class, and a subclass of it.
    const [cls] = await tx
      .select()
      .from(classes)
      .where(and(eq(classes.id, request.classId), eq(classes.campaignId, scope.campaignId)));
    if (cls === undefined) throw httpError(404, 'Class not found');
    const [sub] = await tx
      .select({ classId: subclasses.classId })
      .from(subclasses)
      .where(
        and(eq(subclasses.id, request.subclassId), eq(subclasses.campaignId, scope.campaignId)),
      );
    if (sub === undefined) throw httpError(404, 'Subclass not found');
    if (sub.classId !== cls.id) throw httpError(400, BUILD_MESSAGES.subclassOfClass);

    // One species, or two for a mixed ancestry (the schema keeps them different).
    const speciesIds = request.speciesIds.filter((id) => id !== null);
    const found = await tx
      .select({ id: species.id })
      .from(species)
      .where(and(inArray(species.id, speciesIds), eq(species.campaignId, scope.campaignId)));
    if (found.length !== speciesIds.length) throw httpError(404, 'Species not found');

    const traitProblem = traitsProblem(request.traits, ruleset);
    if (traitProblem !== null) throw httpError(400, traitProblem);

    // The gear, as the campaign's mode says.
    const gear = await getStartingGear(tx, scope);
    let equipped = {
      primaryWeaponId: null as string | null,
      secondaryWeaponId: null as string | null,
      armorId: null as string | null,
    };
    if (gear.mode === 'default') {
      if (request.gear === null) throw httpError(400, BUILD_MESSAGES.gearNeeded);
      const picks = request.gear;
      const problem = defaultGearProblem({
        primary: await weaponOf(tx, scope, picks.primaryWeaponId),
        secondary: await weaponOf(tx, scope, picks.secondaryWeaponId),
        armor: await armorOf(tx, scope, picks.armorId),
      });
      if (problem !== null) throw httpError(400, problem);
      equipped = {
        primaryWeaponId: picks.primaryWeaponId,
        secondaryWeaponId: picks.secondaryWeaponId,
        armorId: picks.armorId,
      };
    } else {
      if (request.gear !== null) throw httpError(400, BUILD_MESSAGES.noGearToPick);
      if (gear.mode === 'set') {
        equipped = {
          primaryWeaponId: gear.kit.primaryWeaponId,
          secondaryWeaponId: gear.kit.secondaryWeaponId,
          armorId: gear.kit.armorId,
        };
      }
    }

    // Two level-1 cards from the class's domains (strict, D-66).
    const cards =
      request.cardIds.length === 0
        ? []
        : await tx
            .select({
              id: domainCards.id,
              name: domainCards.name,
              domainId: domainCards.domainId,
              level: domainCards.level,
            })
            .from(domainCards)
            .where(
              and(
                inArray(domainCards.id, request.cardIds),
                eq(domainCards.campaignId, scope.campaignId),
              ),
            );
    if (cards.length !== new Set(request.cardIds).size) {
      throw httpError(404, 'Domain card not found');
    }
    const picked = request.cardIds.flatMap((id) => cards.filter((card) => card.id === id));
    const cardProblem = creationCardProblem(picked, [cls.domain1Id, cls.domain2Id], ruleset);
    if (cardProblem !== null) throw httpError(400, cardProblem);

    // The starting items and gold, added to what the sheet already carries.
    const { items, gold } = startingItems(gear.mode, gear.kit, request.gear?.potion ?? null);
    const inventory: InventoryItem[] = [
      ...row.inventory,
      ...items.map((item) => ({ name: item.name, detail: item.detail })),
    ];

    const [first, second] = request.speciesIds;
    const updated = await tx
      .update(characters)
      .set({
        name: request.name,
        publicDescription: request.publicDescription,
        classId: cls.id,
        subclassId: request.subclassId,
        subclassCards: 1,
        species1Id: first,
        species2Id: second,
        ...equipped,
        traits: request.traits,
        level: 1,
        proficiency: proficiency.start,
        evasion: cls.startingEvasion,
        hpMax: cls.startingHp,
        hpCurrent: cls.startingHp,
        stressMax: start.stressSlots,
        stressCurrent: 0,
        hope: start.hope,
        hopeBonus: 0,
        armorScore: 0,
        armorSlotsMax: 0,
        armorSlotsMarked: 0,
        className: '',
        weapons: { primary: null, secondary: null, inventory: row.weapons.inventory },
        armor: null,
        classFeature: null,
        inventory,
        gold: {
          handfuls: row.gold.handfuls + gold.handfuls,
          bags: row.gold.bags + gold.bags,
          chests: row.gold.chests + gold.chests,
        },
        needsGuide: false,
        builtAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(characters.id, characterId), eq(characters.campaignId, scope.campaignId)))
      .returning({ id: characters.id });
    if (updated.length === 0) throw httpError(404, NOT_FOUND);

    await tx
      .delete(characterDomainCards)
      .where(
        and(
          eq(characterDomainCards.characterId, characterId),
          eq(characterDomainCards.campaignId, scope.campaignId),
        ),
      );
    await tx.insert(characterDomainCards).values(
      picked.map((card) => ({
        characterId,
        campaignId: scope.campaignId,
        cardId: card.id,
        place: 'loadout' as const,
        takenAtLevel: 1,
      })),
    );
  });
}

/**
 * The GM sends a PC through the guide (`needsGuide` true), or takes it back. Nothing else
 * changes until the guide's Finish. Callers check `assertGm` and `assertWritable`.
 */
export async function setNeedsGuide(
  db: Database,
  scope: CampaignScope,
  characterId: string,
  needsGuide: boolean,
): Promise<void> {
  const updated = await db
    .update(characters)
    .set({ needsGuide, updatedAt: new Date() })
    .where(and(eq(characters.id, characterId), eq(characters.campaignId, scope.campaignId)))
    .returning({ id: characters.id });
  if (updated.length === 0) throw httpError(404, NOT_FOUND);
}
