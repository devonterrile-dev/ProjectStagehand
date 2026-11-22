/**
 * What a sheet holds of the gameplay records beyond its link columns (F4.7, D-65): linked spare
 * weapons, and the PC's domain cards with where each is (loadout or vault). Rows go with their
 * PC; a weapon or card a sheet holds can't be deleted.
 *
 * Only the data-access layer in `src/campaigns/` queries these tables.
 */
import {
  CARD_PLACES,
  type CardPlace,
  type LevelUpColumns,
  type LevelUpPick,
} from '@stagehand/shared';
import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import { characters } from './campaigns';
import { domainCards, weapons } from './gameplay';

/** A PC's linked spare weapons, in order; the same weapon may be carried twice. */
export const characterWeapons = pgTable(
  'character_weapons',
  {
    characterId: uuid('character_id').notNull(),
    campaignId: uuid('campaign_id').notNull(),
    position: integer('position').notNull(),
    weaponId: uuid('weapon_id').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.characterId, table.position] }),
    index('character_weapons_campaign_weapon_idx').on(table.campaignId, table.weaponId),
    foreignKey({
      name: 'character_weapons_character_fk',
      columns: [table.characterId, table.campaignId],
      foreignColumns: [characters.id, characters.campaignId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'character_weapons_weapon_fk',
      columns: [table.weaponId, table.campaignId],
      foreignColumns: [weapons.id, weapons.campaignId],
    }),
    check('character_weapons_position', sql`${table.position} >= 0`),
  ],
);

export const cardPlace = pgEnum('card_place', CARD_PLACES);

/** A PC's domain cards (§9 "Domain card loadout"): each held once, in the loadout or the vault. */
export const characterDomainCards = pgTable(
  'character_domain_cards',
  {
    characterId: uuid('character_id').notNull(),
    campaignId: uuid('campaign_id').notNull(),
    cardId: uuid('card_id').notNull(),
    place: cardPlace('place').notNull(),
    /** The PC's level when it was added. */
    takenAtLevel: integer('taken_at_level').notNull(),
    addedAt: timestamp('added_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.characterId, table.cardId] }),
    index('character_domain_cards_campaign_card_idx').on(table.campaignId, table.cardId),
    foreignKey({
      name: 'character_domain_cards_character_fk',
      columns: [table.characterId, table.campaignId],
      foreignColumns: [characters.id, characters.campaignId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'character_domain_cards_card_fk',
      columns: [table.cardId, table.campaignId],
      foreignColumns: [domainCards.id, domainCards.campaignId],
    }),
    check('character_domain_cards_level', sql`${table.takenAtLevel} >= 1`),
  ],
);

/** What a level-up did to the PC's cards, so it can be undone. */
export interface LevelUpCards {
  /** The new card and any extra card, added. */
  added: string[];
  /** A swap: the held card taken out, its place, and the card put in. */
  swap: { outId: string; inId: string; place: CardPlace; takenAtLevel: number } | null;
}

/**
 * A PC's level-ups (F4.9, §9 "Leveling up", D-68): the level reached, the options picked, what it
 * did to the cards, and the sheet's values before it, so the GM can undo the latest exactly.
 * Option counts and trait marks are read from these rows.
 */
export const characterLevelUps = pgTable(
  'character_level_ups',
  {
    id: uuid('id')
      .default(sql`pg_catalog.gen_random_uuid()`)
      .primaryKey(),
    characterId: uuid('character_id').notNull(),
    campaignId: uuid('campaign_id').notNull(),
    /** The level reached. */
    level: integer('level').notNull(),
    picks: jsonb('picks').$type<LevelUpPick[]>().notNull(),
    cards: jsonb('cards').$type<LevelUpCards>().notNull(),
    /** The sheet's values before it, as `levelUpEffects` reads and writes them. */
    before: jsonb('before').$type<LevelUpColumns>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('character_level_ups_character_level_idx').on(table.characterId, table.level),
    foreignKey({
      name: 'character_level_ups_character_fk',
      columns: [table.characterId, table.campaignId],
      foreignColumns: [characters.id, characters.campaignId],
    }).onDelete('cascade'),
    check('character_level_ups_level', sql`${table.level} >= 2`),
  ],
);
