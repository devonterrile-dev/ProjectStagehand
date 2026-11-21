/**
 * A campaign's gameplay records as a whole (F4.3, governance §8 "Gameplay records", D-61): the
 * ten default domains a fresh campaign starts with, and the copy a new campaign can take of
 * another campaign's records instead (19.14). A copy is made once: afterwards the two campaigns'
 * records change apart.
 *
 * Each gameplay type added later (classes, gear, species: F4.4 to F4.6) is copied here too.
 */
import { DEFAULT_DOMAINS } from '@stagehand/shared';
import { asc, eq } from 'drizzle-orm';

import { domainCards, domains, statBlocks } from '../db/schema';

import type { DbOrTx } from './members';

/** Gives a campaign the ten default domains. */
export async function seedDefaultDomains(tx: DbOrTx, campaignId: string): Promise<void> {
  await tx.insert(domains).values(
    DEFAULT_DOMAINS.map((domain) => ({
      campaignId,
      name: domain.name,
      description: domain.description,
    })),
  );
}

/**
 * Copies every gameplay record of `fromId` into `toId`: domains, their cards (pointed at the new
 * domains) and stat blocks. Stat blocks come without the NPCs that link them: campaign records
 * aren't copied. The caller checks the user may read `fromId` as its GM.
 */
export async function copyGameplayRecords(tx: DbOrTx, fromId: string, toId: string): Promise<void> {
  const fromDomains = await tx
    .select()
    .from(domains)
    .where(eq(domains.campaignId, fromId))
    .orderBy(asc(domains.createdAt), asc(domains.id));
  const newDomainOf = new Map<string, string>();
  if (fromDomains.length > 0) {
    const made = await tx
      .insert(domains)
      .values(
        fromDomains.map((domain) => ({
          campaignId: toId,
          name: domain.name,
          description: domain.description,
        })),
      )
      .returning({ id: domains.id, name: domains.name });
    // Names are unique in a campaign whatever their case, so they pair each copy with its source.
    const madeByName = new Map(made.map((copy) => [copy.name.toLowerCase(), copy.id]));
    for (const domain of fromDomains) {
      const copy = madeByName.get(domain.name.toLowerCase());
      if (copy !== undefined) newDomainOf.set(domain.id, copy);
    }
  }

  const fromCards = await tx.select().from(domainCards).where(eq(domainCards.campaignId, fromId));
  const cards = fromCards.flatMap((card) => {
    const domainId = newDomainOf.get(card.domainId);
    if (domainId === undefined) return [];
    return [
      {
        campaignId: toId,
        domainId,
        name: card.name,
        level: card.level,
        recallCost: card.recallCost,
        type: card.type,
        feature: card.feature,
      },
    ];
  });
  if (cards.length > 0) await tx.insert(domainCards).values(cards);

  const fromBlocks = await tx.select().from(statBlocks).where(eq(statBlocks.campaignId, fromId));
  if (fromBlocks.length > 0) {
    await tx.insert(statBlocks).values(
      fromBlocks.map((block) => ({
        campaignId: toId,
        name: block.name,
        tier: block.tier,
        role: block.role,
        publicDescription: block.publicDescription,
        difficulty: block.difficulty,
        attackModifier: block.attackModifier,
        standardAttack: block.standardAttack,
        experiences: block.experiences,
        motives: block.motives,
        features: block.features,
        majorThreshold: block.majorThreshold,
        severeThreshold: block.severeThreshold,
        hpMax: block.hpMax,
        stressMax: block.stressMax,
      })),
    );
  }
}
