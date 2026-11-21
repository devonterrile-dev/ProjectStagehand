/**
 * What a sheet holds of the gameplay records beyond its link columns (F4.7, D-65): linked spare
 * weapons, and the PC's domain cards with where each is (loadout or vault). Rows go with their
 * PC; a weapon or card a sheet holds can't be deleted.
 *
 * Only the data-access layer in `src/campaigns/` queries these tables.
 */
import { CARD_PLACES } from '@stagehand/shared';
import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
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
