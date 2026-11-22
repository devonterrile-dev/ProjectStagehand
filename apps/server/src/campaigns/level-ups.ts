/**
 * Leveling up (F4.9, governance §9 "Leveling up", D-68). Part of the campaign data-access layer:
 * every query is scoped to `scope.campaignId`.
 *
 * - The GM grants the next level (one at a time, up to the ruleset's last), or withdraws it. A PC
 *   needs a linked class to level up with the guide.
 * - The PC's own player, or the GM, levels up a PC with a grant: the shared rules
 *   (`levelUpProblem`, `levelUpEffects`) check the picks and work out the new values, written
 *   with a history row holding the values before, so the GM can undo the latest exactly.
 * - The new card (and any extra card) goes in the loadout while it has room, else the vault; a
 *   swapped-in card takes the place of the card swapped out.
 *
 * Every change holds the PC's row; a level-up during a session is logged.
 */
import {
  LEVEL_UP_MESSAGES,
  levelUpEffects,
  levelUpProblem,
  levelUpState,
  loadoutMaxOf,
  rulesetFor,
  type CardPlace,
  type LevelUpColumns,
  type LevelUpRequest,
} from '@stagehand/shared';
import { and, count, desc, eq, inArray } from 'drizzle-orm';

import type { Database } from '../db/client';
import {
  characterDomainCards,
  characterLevelUps,
  characters,
  classes,
  domainCards,
  playSessions,
  subclasses,
  type LevelUpCards,
} from '../db/schema';
import { httpError } from '../http/errors';

import { findSheet } from './characters';
import { levelUpHistory } from './level-up-history';
import type { DbOrTx } from './members';
import { logEvent, running } from './session-core';
import type { CampaignScope } from './scope';

type CharacterRow = Awaited<ReturnType<typeof findSheet>>['row'];

const NOT_FOUND = 'Character not found';

function scoped(scope: CampaignScope, characterId: string) {
  return and(eq(characters.id, characterId), eq(characters.campaignId, scope.campaignId));
}

function heldWhere(scope: CampaignScope, characterId: string) {
  return and(
    eq(characterDomainCards.characterId, characterId),
    eq(characterDomainCards.campaignId, scope.campaignId),
  );
}

/** The values a level-up changes, as stored. */
function columnsOf(row: CharacterRow): LevelUpColumns {
  return {
    level: row.level,
    traits: { ...row.traits },
    hpMax: row.hpMax,
    hpCurrent: row.hpCurrent,
    stressMax: row.stressMax,
    hopeBonus: row.hopeBonus,
    evasion: row.evasion,
    proficiency: row.proficiency,
    subclassCards: row.subclassCards,
    minorThreshold: row.minorThreshold,
    majorThreshold: row.majorThreshold,
    severeThreshold: row.severeThreshold,
    multiclassClassId: row.multiclassClassId,
    multiclassDomainId: row.multiclassDomainId,
    multiclassSubclassId: row.multiclassSubclassId,
    multiclassSubclassCards: row.multiclassSubclassCards,
  };
}

/** The GM grants the next level, or withdraws a grant. Callers check `assertGm`, `assertWritable`. */
export async function grantLevel(
  db: Database,
  scope: CampaignScope,
  characterId: string,
  granted: boolean,
): Promise<void> {
  const ruleset = rulesetFor(scope.campaign.rulesetVersion);
  await db.transaction(async (tx) => {
    const { row } = await findSheet(tx, scope, characterId, true);
    if (granted) {
      if (row.level >= (ruleset.levels?.max ?? row.level)) {
        throw httpError(409, LEVEL_UP_MESSAGES.maxLevel);
      }
      if (row.classId === null) throw httpError(400, LEVEL_UP_MESSAGES.needsClass);
      if (row.levelUpGranted) throw httpError(409, LEVEL_UP_MESSAGES.alreadyGranted);
    }
    await tx
      .update(characters)
      .set({ levelUpGranted: granted, updatedAt: new Date() })
      .where(scoped(scope, characterId));
  });
}

/**
 * Levels up a PC with a grant, by its own player or the GM (anyone else gets 404). Returns
 * whether a session line was written. Callers check `assertWritable`.
 */
export async function levelUp(
  db: Database,
  scope: CampaignScope,
  characterId: string,
  request: LevelUpRequest,
): Promise<{ logged: boolean }> {
  const ruleset = rulesetFor(scope.campaign.rulesetVersion);
  return db.transaction(async (tx) => {
    const { row, assignedToUserId } = await findSheet(tx, scope, characterId, true);
    if (scope.role !== 'gm' && assignedToUserId !== scope.userId) {
      throw httpError(404, NOT_FOUND);
    }
    if (!row.levelUpGranted) throw httpError(409, LEVEL_UP_MESSAGES.noGrant);
    if (row.classId === null) throw httpError(400, LEVEL_UP_MESSAGES.needsClass);
    const [cls] = await tx
      .select({ domain1Id: classes.domain1Id, domain2Id: classes.domain2Id })
      .from(classes)
      .where(and(eq(classes.id, row.classId), eq(classes.campaignId, scope.campaignId)));
    if (cls === undefined) throw httpError(400, LEVEL_UP_MESSAGES.needsClass);

    const state = levelUpState(
      await levelUpHistory(tx, scope, characterId),
      row.level,
      ruleset,
      row.multiclassClassId !== null,
    );
    const before = columnsOf(row);
    const traits = Object.fromEntries(
      ruleset.traits.map((trait) => [trait.id, row.traits[trait.id] ?? 0]),
    );
    const held = await tx
      .select({
        cardId: characterDomainCards.cardId,
        place: characterDomainCards.place,
        takenAtLevel: characterDomainCards.takenAtLevel,
      })
      .from(characterDomainCards)
      .where(heldWhere(scope, characterId));
    const cards = await tx
      .select({
        id: domainCards.id,
        name: domainCards.name,
        domainId: domainCards.domainId,
        level: domainCards.level,
      })
      .from(domainCards)
      .where(eq(domainCards.campaignId, scope.campaignId));
    // The campaign's classes, to pick a second class from (F4.10).
    const classRows = await tx
      .select({
        id: classes.id,
        name: classes.name,
        domain1Id: classes.domain1Id,
        domain2Id: classes.domain2Id,
      })
      .from(classes)
      .where(eq(classes.campaignId, scope.campaignId));
    const subclassRows = await tx
      .select({ id: subclasses.id, classId: subclasses.classId })
      .from(subclasses)
      .where(eq(subclasses.campaignId, scope.campaignId));
    const problem = levelUpProblem(
      request,
      state,
      {
        traits,
        subclassCards: row.subclassId === null ? null : row.subclassCards,
        domainIds: [cls.domain1Id, cls.domain2Id],
        cards,
        heldIds: held.map((entry) => entry.cardId),
        classId: row.classId,
        classes: classRows.map((one) => ({
          id: one.id,
          name: one.name,
          domainIds: [one.domain1Id, one.domain2Id],
          subclassIds: subclassRows.filter((sub) => sub.classId === one.id).map((sub) => sub.id),
        })),
        multiclass:
          row.multiclassClassId === null
            ? null
            : {
                domainId: row.multiclassDomainId,
                subclassId: row.multiclassSubclassId,
                subclassCards: row.multiclassSubclassCards,
              },
      },
      ruleset,
    );
    if (problem !== null) throw httpError(400, problem);

    // Linked armor and an unarmored sheet follow the level already; typed thresholds rise here.
    const typedThresholds = row.armorId === null && !(row.builtAt !== null && row.armor === null);
    const after = levelUpEffects(request, state, { ...before, traits }, typedThresholds, ruleset);
    await tx
      .update(characters)
      .set({ ...after, levelUpGranted: false, updatedAt: new Date() })
      .where(scoped(scope, characterId));

    // The new cards: the loadout while it has room, else the vault.
    const added = [request.cardId, ...(request.extraCardId === null ? [] : [request.extraCardId])];
    let inLoadout = held.filter((entry) => entry.place === 'loadout').length;
    const loadoutMax = loadoutMaxOf(ruleset);
    for (const cardId of added) {
      const place: CardPlace = inLoadout < loadoutMax ? 'loadout' : 'vault';
      if (place === 'loadout') inLoadout += 1;
      await tx.insert(characterDomainCards).values({
        characterId,
        campaignId: scope.campaignId,
        cardId,
        place,
        takenAtLevel: after.level,
      });
    }
    let swap: LevelUpCards['swap'] = null;
    if (request.swap !== null) {
      const out = held.find((entry) => entry.cardId === request.swap?.outId);
      if (out !== undefined) {
        swap = { ...request.swap, place: out.place, takenAtLevel: out.takenAtLevel };
        await tx
          .delete(characterDomainCards)
          .where(and(heldWhere(scope, characterId), eq(characterDomainCards.cardId, out.cardId)));
        await tx.insert(characterDomainCards).values({
          characterId,
          campaignId: scope.campaignId,
          cardId: request.swap.inId,
          place: out.place,
          takenAtLevel: after.level,
        });
      }
    }

    await tx.insert(characterLevelUps).values({
      characterId,
      campaignId: scope.campaignId,
      level: after.level,
      picks: request.picks,
      cards: { added, swap },
      before,
    });

    const [session] = await tx
      .select({ id: playSessions.id })
      .from(playSessions)
      .where(running(scope));
    if (session === undefined) return { logged: false };
    await logEvent(tx, scope, session, 'level_up', {
      actorUserId: scope.userId,
      data: { characterId, characterName: row.name, level: after.level },
    });
    return { logged: true };
  });
}

/**
 * The GM undoes the latest level-up: the sheet's values before it come back, the cards it added
 * go, a swap is reversed (the card swapped out returns if it still exists), and the level is
 * granted again so the player can level up anew. Callers check `assertGm`, `assertWritable`.
 */
export async function undoLevelUp(
  db: Database,
  scope: CampaignScope,
  characterId: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    await findSheet(tx, scope, characterId, true);
    const [latest] = await tx
      .select()
      .from(characterLevelUps)
      .where(
        and(
          eq(characterLevelUps.characterId, characterId),
          eq(characterLevelUps.campaignId, scope.campaignId),
        ),
      )
      .orderBy(desc(characterLevelUps.level), desc(characterLevelUps.createdAt))
      .limit(1);
    if (latest === undefined) throw httpError(409, LEVEL_UP_MESSAGES.noLevelUp);

    await tx
      .update(characters)
      .set({ ...latest.before, levelUpGranted: true, updatedAt: new Date() })
      .where(scoped(scope, characterId));

    const { added, swap } = latest.cards;
    const remove = [...added, ...(swap === null ? [] : [swap.inId])];
    if (remove.length > 0) {
      await tx
        .delete(characterDomainCards)
        .where(and(heldWhere(scope, characterId), inArray(characterDomainCards.cardId, remove)));
    }
    if (swap !== null) {
      await restoreSwappedOut(tx, scope, characterId, swap);
    }
    await tx.delete(characterLevelUps).where(eq(characterLevelUps.id, latest.id));
  });
}

/** Puts a swapped-out card back where it was, if the campaign still has it and it isn't held. */
async function restoreSwappedOut(
  tx: DbOrTx,
  scope: CampaignScope,
  characterId: string,
  swap: NonNullable<LevelUpCards['swap']>,
): Promise<void> {
  const [card] = await tx
    .select({ id: domainCards.id })
    .from(domainCards)
    .where(and(eq(domainCards.id, swap.outId), eq(domainCards.campaignId, scope.campaignId)));
  if (card === undefined) return;
  const [heldNow] = await tx
    .select({ n: count() })
    .from(characterDomainCards)
    .where(and(heldWhere(scope, characterId), eq(characterDomainCards.cardId, swap.outId)));
  if ((heldNow?.n ?? 0) > 0) return;
  await tx.insert(characterDomainCards).values({
    characterId,
    campaignId: scope.campaignId,
    cardId: swap.outId,
    place: swap.place,
    takenAtLevel: swap.takenAtLevel,
  });
}
