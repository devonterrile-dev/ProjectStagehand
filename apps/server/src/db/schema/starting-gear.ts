/**
 * A campaign's starting gear (F4.8, governance §8 "Starting gear", D-66): how the creation guide
 * hands out gear, and the GM's kit for the Set mode. One row per campaign, made when the GM first
 * saves it; a campaign without one uses the Default mode and an empty kit. Its own table, not
 * columns on `campaigns`, since the kit points at gear that points back at the campaign.
 *
 * The kit's gear columns are composite FKs with no action; deleting gear clears it from the kit
 * first (as class suggestions, D-63).
 *
 * Only the data-access layer in `src/campaigns/` queries this table.
 */
import { STARTING_GEAR_MODES, type Gold, type KitItem } from '@stagehand/shared';
import { foreignKey, jsonb, pgEnum, pgTable, timestamp, uuid } from 'drizzle-orm/pg-core';

import { campaigns } from './campaigns';
import { armor, weapons } from './gameplay';

export const startingGearMode = pgEnum('starting_gear_mode', STARTING_GEAR_MODES);

export const startingKits = pgTable(
  'starting_kits',
  {
    campaignId: uuid('campaign_id')
      .primaryKey()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    mode: startingGearMode('mode').default('default').notNull(),
    primaryWeaponId: uuid('primary_weapon_id'),
    secondaryWeaponId: uuid('secondary_weapon_id'),
    armorId: uuid('armor_id'),
    items: jsonb('items').$type<KitItem[]>().default([]).notNull(),
    gold: jsonb('gold').$type<Gold>().default({ handfuls: 0, bags: 0, chests: 0 }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    foreignKey({
      name: 'starting_kits_primary_weapon_fk',
      columns: [table.primaryWeaponId, table.campaignId],
      foreignColumns: [weapons.id, weapons.campaignId],
    }),
    foreignKey({
      name: 'starting_kits_secondary_weapon_fk',
      columns: [table.secondaryWeaponId, table.campaignId],
      foreignColumns: [weapons.id, weapons.campaignId],
    }),
    foreignKey({
      name: 'starting_kits_armor_fk',
      columns: [table.armorId, table.campaignId],
      foreignColumns: [armor.id, armor.campaignId],
    }),
  ],
);
