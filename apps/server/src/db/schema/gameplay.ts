/**
 * Gameplay records (governance §8 "Gameplay records", D-58, D-61, D-62): domains and domain
 * cards (F4.3), weapons and armor (F4.4); classes and species join them in F4.5 and F4.6. Each
 * type has its own table with real columns, per campaign. Every member reads them; only the GM writes them.
 *
 * Only the data-access layer in `src/campaigns/` queries these tables.
 */
import {
  BURDENS,
  DAMAGE_KINDS,
  DOMAIN_CARD_TYPES,
  emptyRichText,
  noGearBonuses,
  WEAPON_RANGES,
  WEAPON_SLOTS,
  type GearBonuses,
  type RichText,
} from '@stagehand/shared';
import { sql, type SQL } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { campaigns } from './campaigns';

/** A campaign's domains. Every campaign starts with the ten defaults (F4.3, 19.26). */
export const domains = pgTable(
  'domains',
  {
    id: uuid('id')
      .default(sql`pg_catalog.gen_random_uuid()`)
      .primaryKey(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** Plain text; line breaks kept. */
    description: text('description').default('').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    /** One domain of a name per campaign, whatever its case. */
    uniqueIndex('domains_campaign_name_idx').on(table.campaignId, sql`lower(${table.name})`),
    /** Target of the composite FK from `domain_cards`. */
    unique('domains_id_campaign_id_unique').on(table.id, table.campaignId),
    check('domains_name_length', sql`char_length(${table.name}) between 1 and 60`),
    check('domains_description_length', sql`char_length(${table.description}) <= 2000`),
  ],
);

export const domainCardType = pgEnum('domain_card_type', DOMAIN_CARD_TYPES);

/** A campaign's domain cards, each of one of its domains. */
export const domainCards = pgTable(
  'domain_cards',
  {
    id: uuid('id')
      .default(sql`pg_catalog.gen_random_uuid()`)
      .primaryKey(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    /** A domain of the same campaign; a domain with cards can't be deleted. */
    domainId: uuid('domain_id').notNull(),
    name: text('name').notNull(),
    /** 1 to 10: the PC must be at least this level to take it. */
    level: integer('level').default(1).notNull(),
    /** The Stress marked to bring it from the vault into the loadout. */
    recallCost: integer('recall_cost').default(0).notNull(),
    type: domainCardType('type').default('ability').notNull(),
    /** The bulk of the card. */
    feature: jsonb('feature').$type<RichText>().default(emptyRichText()).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index('domain_cards_campaign_domain_idx').on(table.campaignId, table.domainId),
    /**
     * No action (checked at the end of the statement), not restrict: deleting a campaign removes
     * its domains and cards in one go, while deleting a domain that still has cards is refused.
     */
    foreignKey({
      name: 'domain_cards_domain_fk',
      columns: [table.domainId, table.campaignId],
      foreignColumns: [domains.id, domains.campaignId],
    }),
    check('domain_cards_name_length', sql`char_length(${table.name}) between 1 and 120`),
    check('domain_cards_level', sql`${table.level} between 1 and 10`),
    check('domain_cards_recall_cost', sql`${table.recallCost} between 0 and 99`),
  ],
);

export const weaponSlot = pgEnum('weapon_slot', WEAPON_SLOTS);
export const damageKind = pgEnum('damage_kind', DAMAGE_KINDS);
export const weaponRange = pgEnum('weapon_range', WEAPON_RANGES);
export const weaponBurden = pgEnum('weapon_burden', BURDENS);

/** A bonus to a gear number while equipped: -99 to +99 (19.25). */
const bonusCheck = (name: string, value: SQL) => check(name, sql`${value} between -99 and 99`);

/** A campaign's weapons, by tier (F4.4). Sheets and classes will link them (F4.5, F4.7). */
export const weapons = pgTable(
  'weapons',
  {
    id: uuid('id')
      .default(sql`pg_catalog.gen_random_uuid()`)
      .primaryKey(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    tier: integer('tier').default(1).notNull(),
    name: text('name').notNull(),
    slot: weaponSlot('slot').default('primary').notNull(),
    kind: damageKind('kind').default('physical').notNull(),
    /** A trait id of the campaign's ruleset, checked by the data-access layer. */
    trait: text('trait').notNull(),
    range: weaponRange('range').default('melee').notNull(),
    /** Damage is proficiency × this die, plus `damage_bonus`. */
    damageDie: integer('damage_die').default(6).notNull(),
    damageBonus: integer('damage_bonus').default(0).notNull(),
    burden: weaponBurden('burden').default('one_handed').notNull(),
    featureName: text('feature_name').default('').notNull(),
    featureText: text('feature_text').default('').notNull(),
    /** Validated JSON: `GearBonuses`. */
    bonuses: jsonb('bonuses').$type<GearBonuses>().default(noGearBonuses()).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index('weapons_campaign_tier_idx').on(table.campaignId, table.tier),
    /** Target of composite FKs from classes and sheets (F4.5, F4.7). */
    unique('weapons_id_campaign_id_unique').on(table.id, table.campaignId),
    check('weapons_name_length', sql`char_length(${table.name}) between 1 and 80`),
    check('weapons_tier', sql`${table.tier} between 1 and 4`),
    check('weapons_damage_die', sql`${table.damageDie} in (4, 6, 8, 10, 12, 20)`),
    bonusCheck('weapons_damage_bonus', sql`${table.damageBonus}`),
    /** A secondary weapon is always one-handed. */
    check(
      'weapons_secondary_one_handed',
      sql`${table.slot} = 'primary' or ${table.burden} = 'one_handed'`,
    ),
    check('weapons_feature_name_length', sql`char_length(${table.featureName}) <= 80`),
    check('weapons_feature_text_length', sql`char_length(${table.featureText}) <= 2000`),
  ],
);

/** A campaign's armor, by tier (F4.4). */
export const armor = pgTable(
  'armor',
  {
    id: uuid('id')
      .default(sql`pg_catalog.gen_random_uuid()`)
      .primaryKey(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    tier: integer('tier').default(1).notNull(),
    name: text('name').notNull(),
    /** The two lines between minor, major and severe damage (19.16); a sheet adds the level. */
    baseMajorThreshold: integer('base_major_threshold').default(0).notNull(),
    baseSevereThreshold: integer('base_severe_threshold').default(0).notNull(),
    /** The sheet's armor slots. */
    baseScore: integer('base_score').default(0).notNull(),
    featureName: text('feature_name').default('').notNull(),
    featureText: text('feature_text').default('').notNull(),
    /** Validated JSON: `GearBonuses`. */
    bonuses: jsonb('bonuses').$type<GearBonuses>().default(noGearBonuses()).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index('armor_campaign_tier_idx').on(table.campaignId, table.tier),
    /** Target of composite FKs from classes and sheets (F4.5, F4.7). */
    unique('armor_id_campaign_id_unique').on(table.id, table.campaignId),
    check('armor_name_length', sql`char_length(${table.name}) between 1 and 80`),
    check('armor_tier', sql`${table.tier} between 1 and 4`),
    /**
     * Each 0 to 999. Severe below major is allowed: the GM's form saves one field at a time,
     * so it only warns (D-62).
     */
    check('armor_major_threshold', sql`${table.baseMajorThreshold} between 0 and 999`),
    check('armor_severe_threshold', sql`${table.baseSevereThreshold} between 0 and 999`),
    check('armor_base_score', sql`${table.baseScore} between 0 and 999`),
    check('armor_feature_name_length', sql`char_length(${table.featureName}) <= 80`),
    check('armor_feature_text_length', sql`char_length(${table.featureText}) <= 2000`),
  ],
);
