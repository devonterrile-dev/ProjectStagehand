/**
 * A PC's domain cards (F4.7, governance §9 "Domain card loadout", D-65). Part of the campaign
 * data-access layer: every query is scoped to `scope.campaignId`.
 *
 * The GM adds and removes cards; any card of the campaign may be added, and the sheet warns
 * about one outside the class's domains or above the PC's level (D-65). At most five lie in the
 * loadout. The PC's player, or the GM, moves a card:
 * - into the vault: free;
 * - into the loadout: free for the GM, and for the player while the running session's Rest is
 *   on. Otherwise it marks Stress equal to the card's recall cost, refused when the PC hasn't
 *   that many Stress slots left (19.24). A full loadout needs `swapOut`, a loadout card that goes
 *   to the vault in the same move.
 *
 * Every change holds the PC's row, so two quick moves go in turn. A player's paid or free
 * recall during a session is logged.
 */
import {
  LOADOUT_FULL,
  loadoutMaxOf,
  notEnoughStress,
  rulesetFor,
  type AddHeldCardRequest,
  type CardPlace,
  type MoveHeldCardRequest,
} from '@stagehand/shared';
import { and, count, eq } from 'drizzle-orm';

import type { Database } from '../db/client';
import { characterDomainCards, characters, domainCards, playSessions } from '../db/schema';
import { httpError } from '../http/errors';

import { findSheet } from './characters';
import type { DbOrTx } from './members';
import { logEvent, running } from './session-core';
import type { CampaignScope } from './scope';

const CARD_NOT_FOUND = 'Domain card not found';
const NOT_HELD = "That card isn't on this sheet";
const ALREADY_HELD = 'That card is already on this sheet';
const SWAP_FROM_LOADOUT = 'Pick a card from the loadout to put in the vault';

/** What a change did, for the live table. */
export interface CardChange {
  /** A session line was written. */
  logged: boolean;
}

function held(scope: CampaignScope, characterId: string, cardId: string) {
  return and(
    eq(characterDomainCards.characterId, characterId),
    eq(characterDomainCards.cardId, cardId),
    eq(characterDomainCards.campaignId, scope.campaignId),
  );
}

async function loadoutCount(tx: DbOrTx, scope: CampaignScope, characterId: string) {
  const [row] = await tx
    .select({ n: count() })
    .from(characterDomainCards)
    .where(
      and(
        eq(characterDomainCards.characterId, characterId),
        eq(characterDomainCards.campaignId, scope.campaignId),
        eq(characterDomainCards.place, 'loadout'),
      ),
    );
  return row?.n ?? 0;
}

async function placeOf(
  tx: DbOrTx,
  scope: CampaignScope,
  characterId: string,
  cardId: string,
): Promise<CardPlace | null> {
  const [row] = await tx
    .select({ place: characterDomainCards.place })
    .from(characterDomainCards)
    .where(held(scope, characterId, cardId));
  return row?.place ?? null;
}

/** The GM gives a PC a card: into the loadout, or the vault when the loadout is full. */
export async function addHeldCard(
  db: Database,
  scope: CampaignScope,
  characterId: string,
  request: AddHeldCardRequest,
): Promise<void> {
  await db.transaction(async (tx) => {
    const { row } = await findSheet(tx, scope, characterId, true);
    const [card] = await tx
      .select({ id: domainCards.id })
      .from(domainCards)
      .where(and(eq(domainCards.id, request.cardId), eq(domainCards.campaignId, scope.campaignId)));
    if (card === undefined) throw httpError(404, CARD_NOT_FOUND);
    if ((await placeOf(tx, scope, characterId, request.cardId)) !== null) {
      throw httpError(409, ALREADY_HELD);
    }
    const full = (await loadoutCount(tx, scope, characterId)) >= loadoutMax(scope);
    const place = request.place ?? (full ? 'vault' : 'loadout');
    if (place === 'loadout' && full) throw httpError(409, LOADOUT_FULL);
    await tx.insert(characterDomainCards).values({
      characterId,
      campaignId: scope.campaignId,
      cardId: request.cardId,
      place,
      takenAtLevel: row.level,
    });
  });
}

/** The GM takes a card off a PC. */
export async function removeHeldCard(
  db: Database,
  scope: CampaignScope,
  characterId: string,
  cardId: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    await findSheet(tx, scope, characterId, true);
    const removed = await tx
      .delete(characterDomainCards)
      .where(held(scope, characterId, cardId))
      .returning({ cardId: characterDomainCards.cardId });
    if (removed.length === 0) throw httpError(404, NOT_HELD);
  });
}

function loadoutMax(scope: CampaignScope): number {
  return loadoutMaxOf(rulesetFor(scope.campaign.rulesetVersion));
}

async function cardName(tx: DbOrTx, scope: CampaignScope, cardId: string): Promise<string> {
  const [row] = await tx
    .select({ name: domainCards.name, recallCost: domainCards.recallCost })
    .from(domainCards)
    .where(and(eq(domainCards.id, cardId), eq(domainCards.campaignId, scope.campaignId)));
  return row?.name ?? '';
}

/**
 * Moves a held card. The player may move only their own PC's cards (another PC is 404); the GM
 * any, for free. See the module comment for the costs.
 */
export async function moveHeldCard(
  db: Database,
  scope: CampaignScope,
  characterId: string,
  cardId: string,
  request: MoveHeldCardRequest,
): Promise<CardChange> {
  return db.transaction(async (tx) => {
    const { row, assignedToUserId } = await findSheet(tx, scope, characterId, true);
    const isGm = scope.role === 'gm';
    if (!isGm && assignedToUserId !== scope.userId) throw httpError(404, 'Character not found');

    const from = await placeOf(tx, scope, characterId, cardId);
    if (from === null) throw httpError(404, NOT_HELD);
    if (from === request.to) return { logged: false };

    if (request.to === 'vault') {
      await tx
        .update(characterDomainCards)
        .set({ place: 'vault' })
        .where(held(scope, characterId, cardId));
      return { logged: false };
    }

    // Into the loadout: make room first if it is full.
    let swappedOut: string | null = null;
    if ((await loadoutCount(tx, scope, characterId)) >= loadoutMax(scope)) {
      if (request.swapOut === undefined) throw httpError(409, LOADOUT_FULL);
      if ((await placeOf(tx, scope, characterId, request.swapOut)) !== 'loadout') {
        throw httpError(400, SWAP_FROM_LOADOUT);
      }
      await tx
        .update(characterDomainCards)
        .set({ place: 'vault' })
        .where(held(scope, characterId, request.swapOut));
      swappedOut = await cardName(tx, scope, request.swapOut);
    }

    const [session] = await tx.select().from(playSessions).where(running(scope));
    const rest = session?.rest === true;
    const [card] = await tx
      .select({ name: domainCards.name, recallCost: domainCards.recallCost })
      .from(domainCards)
      .where(and(eq(domainCards.id, cardId), eq(domainCards.campaignId, scope.campaignId)));
    const stress = isGm || rest ? 0 : (card?.recallCost ?? 0);
    if (stress > 0) {
      const left = row.stressMax - row.stressCurrent;
      if (stress > left) throw httpError(409, notEnoughStress(stress, left));
      await tx
        .update(characters)
        .set({ stressCurrent: row.stressCurrent + stress })
        .where(and(eq(characters.id, characterId), eq(characters.campaignId, scope.campaignId)));
    }
    await tx
      .update(characterDomainCards)
      .set({ place: 'loadout' })
      .where(held(scope, characterId, cardId));

    if (session === undefined || isGm) return { logged: false };
    await logEvent(tx, scope, session, 'card_recall', {
      actorUserId: scope.userId,
      data: { characterName: row.name, cardName: card?.name ?? '', stress, rest, swappedOut },
    });
    return { logged: true };
  });
}
