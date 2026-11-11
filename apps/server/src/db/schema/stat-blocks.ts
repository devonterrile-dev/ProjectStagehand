/**
 * Stat blocks for monsters and NPCs (F1.4, governance §8). Templates only: HP and Stress
 * maximums, no current values. Each copy of a monster on stage tracks its own when battle
 * scenes arrive (F4.2, 19.9). NPC records link one through `records.stat_block_id`.
 *
 * Hybrid storage as for character sheets (D-23): numbers are columns, lists are JSON
 * validated by the shared stat block schemas.
 *
 * Only the data-access layer in `src/campaigns/` queries this table.
 */
import {
  emptyRichText,
  type Ability,
  type Attack,
  type Experience,
  type RichText,
} from '@stagehand/shared';
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { campaigns } from './campaigns';

const statInt = (name: string, initial = 0) => integer(name).default(initial).notNull();

export const statBlocks = pgTable(
  'stat_blocks',
  {
    id: uuid('id')
      .default(sql`pg_catalog.gen_random_uuid()`)
      .primaryKey(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    tier: statInt('tier', 1),
    role: text('role').default('').notNull(),
    publicDescription: jsonb('public_description')
      .$type<RichText>()
      .default(emptyRichText())
      .notNull(),
    difficulty: statInt('difficulty'),
    /** The one number allowed to be negative. */
    attackModifier: statInt('attack_modifier'),
    /** Null = no standard attack yet. */
    standardAttack: jsonb('standard_attack').$type<Attack>(),
    experiences: jsonb('experiences').$type<Experience[]>().default([]).notNull(),
    motives: jsonb('motives').$type<string[]>().default([]).notNull(),
    features: jsonb('features').$type<Ability[]>().default([]).notNull(),
    majorThreshold: statInt('major_threshold'),
    severeThreshold: statInt('severe_threshold'),
    hpMax: statInt('hp_max'),
    stressMax: statInt('stress_max'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index('stat_blocks_campaign_id_idx').on(table.campaignId),
    /** Target of the composite FK from `records`. */
    unique('stat_blocks_id_campaign_id_unique').on(table.id, table.campaignId),
    check('stat_blocks_name_length', sql`char_length(${table.name}) between 1 and 120`),
    check('stat_blocks_role_length', sql`char_length(${table.role}) <= 80`),
    check('stat_blocks_tier_min', sql`${table.tier} >= 1`),
    check(
      'stat_blocks_numbers_nonnegative',
      sql`least(${table.difficulty}, ${table.majorThreshold}, ${table.severeThreshold}, ${table.hpMax}, ${table.stressMax}) >= 0`,
    ),
  ],
);
