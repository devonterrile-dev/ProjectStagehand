/**
 * A campaign's gameplay records as a whole (F4.3, governance §8 "Gameplay records", D-61): the
 * ten default domains a fresh campaign starts with, and the copy a new campaign can take of
 * another campaign's records instead (19.14). A copy is made once: afterwards the two campaigns'
 * records change apart.
 *
 * Each gameplay type is copied here: domains and cards (F4.3), weapons and armor (F4.4), classes
 * and subclasses (F4.5), and species (F4.6).
 */
import { randomUUID } from 'node:crypto';

import { DEFAULT_DOMAINS } from '@stagehand/shared';
import { asc, eq } from 'drizzle-orm';

import {
  armor,
  classes,
  domainCards,
  domains,
  species,
  statBlocks,
  subclasses,
  weapons,
} from '../db/schema';

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
 * domains), stat blocks, weapons, armor, classes (pointed at the new domains and gear), their
 * subclasses, and species. Stat blocks come without the NPCs that link them: campaign records aren't copied.
 * The caller checks the user may read `fromId` as its GM.
 *
 * Gear and class names needn't be unique, so their copies get ids made here, kept in a map from
 * each source id, to point the links at.
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

  const newWeaponOf = new Map<string, string>();
  const fromWeapons = await tx.select().from(weapons).where(eq(weapons.campaignId, fromId));
  if (fromWeapons.length > 0) {
    await tx.insert(weapons).values(
      fromWeapons.map((weapon) => {
        const id = randomUUID();
        newWeaponOf.set(weapon.id, id);
        return {
          id,
          campaignId: toId,
          tier: weapon.tier,
          name: weapon.name,
          slot: weapon.slot,
          kind: weapon.kind,
          trait: weapon.trait,
          range: weapon.range,
          damageDie: weapon.damageDie,
          damageBonus: weapon.damageBonus,
          burden: weapon.burden,
          featureName: weapon.featureName,
          featureText: weapon.featureText,
          bonuses: weapon.bonuses,
        };
      }),
    );
  }

  const newArmorOf = new Map<string, string>();
  const fromArmor = await tx.select().from(armor).where(eq(armor.campaignId, fromId));
  if (fromArmor.length > 0) {
    await tx.insert(armor).values(
      fromArmor.map((piece) => {
        const id = randomUUID();
        newArmorOf.set(piece.id, id);
        return {
          id,
          campaignId: toId,
          tier: piece.tier,
          name: piece.name,
          baseMajorThreshold: piece.baseMajorThreshold,
          baseSevereThreshold: piece.baseSevereThreshold,
          baseScore: piece.baseScore,
          featureName: piece.featureName,
          featureText: piece.featureText,
          bonuses: piece.bonuses,
        };
      }),
    );
  }

  /** The copy of a linked record, or null when unset. */
  const mapped = (map: Map<string, string>, id: string | null) =>
    id === null ? null : (map.get(id) ?? null);

  const newClassOf = new Map<string, string>();
  const fromClasses = await tx.select().from(classes).where(eq(classes.campaignId, fromId));
  if (fromClasses.length > 0) {
    await tx.insert(classes).values(
      fromClasses.map((cls) => {
        const id = randomUUID();
        newClassOf.set(cls.id, id);
        return {
          id,
          campaignId: toId,
          name: cls.name,
          description: cls.description,
          domain1Id: mapped(newDomainOf, cls.domain1Id),
          domain2Id: mapped(newDomainOf, cls.domain2Id),
          startingEvasion: cls.startingEvasion,
          startingHp: cls.startingHp,
          hopeFeature: cls.hopeFeature,
          classFeatures: cls.classFeatures,
          suggestedTraits: cls.suggestedTraits,
          suggestedPrimaryWeaponId: mapped(newWeaponOf, cls.suggestedPrimaryWeaponId),
          suggestedSecondaryWeaponId: mapped(newWeaponOf, cls.suggestedSecondaryWeaponId),
          suggestedArmorId: mapped(newArmorOf, cls.suggestedArmorId),
        };
      }),
    );
  }

  const fromSubclasses = await tx
    .select()
    .from(subclasses)
    .where(eq(subclasses.campaignId, fromId));
  const subs = fromSubclasses.flatMap((sub) => {
    const classId = newClassOf.get(sub.classId);
    if (classId === undefined) return [];
    return [
      {
        campaignId: toId,
        classId,
        name: sub.name,
        description: sub.description,
        spellcastTrait: sub.spellcastTrait,
        foundation: sub.foundation,
        specialization: sub.specialization,
        mastery: sub.mastery,
      },
    ];
  });
  if (subs.length > 0) await tx.insert(subclasses).values(subs);

  const fromSpecies = await tx.select().from(species).where(eq(species.campaignId, fromId));
  if (fromSpecies.length > 0) {
    await tx.insert(species).values(
      fromSpecies.map((one) => ({
        campaignId: toId,
        name: one.name,
        description: one.description,
        features: one.features,
      })),
    );
  }
}
