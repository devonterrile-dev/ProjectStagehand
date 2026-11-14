/**
 * Campaigns, their members (F1.1) and player characters with their sheets (F1.2, F1.4).
 * Governance §7 and §8.
 * `characters` lives here because it and `campaign_members` reference each other.
 *
 * Only the data-access layer in `src/campaigns/` queries these tables.
 */
import {
  emptyRichText,
  type Ability,
  type Armor,
  type ClassFeature,
  type Experience,
  type Gold,
  type InventoryItem,
  type RichText,
  type Weapon,
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
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

import { assets } from './assets';
import { users } from './auth';

export const campaignRole = pgEnum('campaign_role', ['gm', 'player']);

export const campaigns = pgTable(
  'campaigns',
  {
    id: uuid('id')
      .default(sql`pg_catalog.gen_random_uuid()`)
      .primaryKey(),
    name: text('name').notNull(),
    /** The campaign's one GM (D-14). Also present as a `gm` row in `campaign_members`. */
    gmUserId: uuid('gm_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    rulesetVersion: integer('ruleset_version').default(1).notNull(),
    /** Null = active. Set = archived, which makes the campaign read-only (D-20). */
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index('campaigns_gm_user_id_idx').on(table.gmUserId),
    check('campaigns_name_length', sql`char_length(${table.name}) between 1 and 80`),
  ],
);

export const campaignMembers = pgTable(
  'campaign_members',
  {
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: campaignRole('role').notNull(),
    /** The player's PC in this campaign (F1.2). Null for the GM and for players without one. */
    characterId: uuid('character_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.campaignId, table.userId] }),
    /** A PC can only be assigned within its own campaign. */
    foreignKey({
      name: 'campaign_members_character_fk',
      columns: [table.characterId, table.campaignId],
      foreignColumns: [characters.id, characters.campaignId],
    }),
    /** One player per PC (one PC per player follows from the single column). */
    uniqueIndex('campaign_members_character_id_idx').on(table.characterId),
    /** Only players hold a PC. */
    check(
      'campaign_members_pc_players_only',
      sql`${table.role} = 'player' or ${table.characterId} is null`,
    ),
    index('campaign_members_user_id_idx').on(table.userId),
    /** D-14: at most one GM per campaign, enforced by the database. */
    uniqueIndex('campaign_members_one_gm_idx')
      .on(table.campaignId)
      .where(sql`${table.role} = 'gm'`),
  ],
);

/** A PC's weapons: what's in hand, plus spares. */
export interface CharacterWeapons {
  primary: Weapon | null;
  secondary: Weapon | null;
  inventory: Weapon[];
}

/** A sheet number column: whole, never negative (checked below). */
const sheetInt = (name: string, initial = 0) => integer(name).default(initial).notNull();

/**
 * Player characters and their sheets (F1.2, F1.4). Which player has one is
 * `campaign_members.character_id` (D-21).
 *
 * Hybrid storage (D-23): numbers that change in play are columns with database checks;
 * the lists and sections are JSON, validated by the shared sheet schemas. Rules that
 * depend on the campaign's ruleset (the trait list and range, the Hope max) are checked
 * only by those schemas. Every column has a default, so a new PC is a valid blank sheet.
 */
export const characters = pgTable(
  'characters',
  {
    id: uuid('id')
      .default(sql`pg_catalog.gen_random_uuid()`)
      .primaryKey(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),

    level: sheetInt('level', 1),
    className: text('class_name').default('').notNull(),
    publicDescription: jsonb('public_description')
      .$type<RichText>()
      .default(emptyRichText())
      .notNull(),
    /** Private to the GM. */
    gmNotes: jsonb('gm_notes').$type<RichText>().default(emptyRichText()).notNull(),
    /** The puppet's visual in use (F2.3, D-42): one of this PC's own assets. */
    visualAssetId: uuid('visual_asset_id').references((): AnyPgColumn => assets.id, {
      onDelete: 'set null',
    }),
    /** Trait id → modifier; missing traits read as 0. */
    traits: jsonb('traits').$type<Record<string, number>>().default({}).notNull(),

    evasion: sheetInt('evasion'),
    armorScore: sheetInt('armor_score'),
    armorSlotsMax: sheetInt('armor_slots_max'),
    armorSlotsMarked: sheetInt('armor_slots_marked'),
    minorThreshold: sheetInt('minor_threshold'),
    majorThreshold: sheetInt('major_threshold'),
    severeThreshold: sheetInt('severe_threshold'),
    hpMax: sheetInt('hp_max'),
    hpCurrent: sheetInt('hp_current'),
    stressMax: sheetInt('stress_max'),
    stressCurrent: sheetInt('stress_current'),
    hope: sheetInt('hope'),
    proficiency: sheetInt('proficiency', 1),

    experiences: jsonb('experiences').$type<Experience[]>().default([]).notNull(),
    weapons: jsonb('weapons')
      .$type<CharacterWeapons>()
      .default({ primary: null, secondary: null, inventory: [] })
      .notNull(),
    /** Null = no armor. */
    armor: jsonb('armor').$type<Armor>(),
    inventory: jsonb('inventory').$type<InventoryItem[]>().default([]).notNull(),
    gold: jsonb('gold').$type<Gold>().default({ handfuls: 0, bags: 0, chests: 0 }).notNull(),
    /** Null = none yet. */
    classFeature: jsonb('class_feature').$type<ClassFeature>(),
    combatOptions: jsonb('combat_options').$type<Ability[]>().default([]).notNull(),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index('characters_campaign_id_idx').on(table.campaignId),
    /** Target of the composite FK from `campaign_members`. */
    unique('characters_id_campaign_id_unique').on(table.id, table.campaignId),
    check('characters_name_length', sql`char_length(${table.name}) between 1 and 80`),
    check('characters_class_name_length', sql`char_length(${table.className}) <= 80`),
    check('characters_level_min', sql`${table.level} >= 1`),
    check(
      'characters_numbers_nonnegative',
      sql`least(${table.evasion}, ${table.armorScore}, ${table.armorSlotsMax}, ${table.armorSlotsMarked}, ${table.minorThreshold}, ${table.majorThreshold}, ${table.severeThreshold}, ${table.hpMax}, ${table.hpCurrent}, ${table.stressMax}, ${table.stressCurrent}, ${table.hope}, ${table.proficiency}) >= 0`,
    ),
    check('characters_hp_current_max', sql`${table.hpCurrent} <= ${table.hpMax}`),
    check('characters_stress_current_max', sql`${table.stressCurrent} <= ${table.stressMax}`),
    check(
      'characters_armor_slots_marked_max',
      sql`${table.armorSlotsMarked} <= ${table.armorSlotsMax}`,
    ),
  ],
);
