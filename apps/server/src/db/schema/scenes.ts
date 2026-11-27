/**
 * Scenes (F3.2, governance §8 and §12, D-49): a saved arrangement of the theater, and the
 * props and NPC puppets placed in it.
 *
 * A scene stores its Spot, not a backdrop image: the backdrop is the Spot's image in use when
 * the scene is read, so replacing that image (which deletes the old one's files, D-44) never
 * leaves a scene pointing at nothing. An object likewise stores its record, and is drawn with
 * the record's image in use.
 *
 * PCs are never saved in a scene (D-36), so an object is always a record. Puppets are saved
 * lowered: `shown` is a prop's flag and stays false for a puppet, whose place is where it will
 * rise to.
 *
 * A scene has no type of its own: it is its Spot's, static or transition (F5.4, D-75), read with
 * the Spot like the backdrop.
 *
 * The record and the Spot must be in the scene's campaign, and of the right type: checked by
 * the data layer, as for `assets`. Only `src/campaigns/scenes.ts` queries these tables.
 */
import { PROP_MOUNTS, SCENE_OBJECT_KINDS, TRAVEL_MODES } from '@stagehand/shared';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  doublePrecision,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { campaigns } from './campaigns';
import { records } from './records';

export const sceneObjectKind = pgEnum('scene_object_kind', SCENE_OBJECT_KINDS);
export const propMount = pgEnum('prop_mount', PROP_MOUNTS);
/** How an NPC puppet travels in a transition scene (F5.4). */
export const travelMode = pgEnum('travel_mode', TRAVEL_MODES);

export const scenes = pgTable(
  'scenes',
  {
    id: uuid('id')
      .default(sql`pg_catalog.gen_random_uuid()`)
      .primaryKey(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** The Spot whose image in use is the backdrop. Deleting the Spot leaves a bare wall. */
    spotId: uuid('spot_id').references(() => records.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    /** Also moved on by a change to the scene's objects. */
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index('scenes_campaign_id_idx').on(table.campaignId),
    /** The set-null when a Spot is deleted. */
    index('scenes_spot_id_idx').on(table.spotId),
    check('scenes_name_length', sql`char_length(${table.name}) between 1 and 120`),
  ],
);

export const sceneObjects = pgTable(
  'scene_objects',
  {
    /** Made by the browser when the object is placed, so it never changes. */
    id: uuid('id')
      .default(sql`pg_catalog.gen_random_uuid()`)
      .primaryKey(),
    sceneId: uuid('scene_id')
      .notNull()
      .references(() => scenes.id, { onDelete: 'cascade' }),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    kind: sceneObjectKind('kind').notNull(),
    /** A Prop or Item for a prop, an NPC for a puppet. Deleting it takes the object along. */
    recordId: uuid('record_id')
      .notNull()
      .references(() => records.id, { onDelete: 'cascade' }),
    /** 0 (left edge of the opening) to 1 (right edge), for the cutout's bottom center. */
    across: doublePrecision('across').notNull(),
    /** 0 (bottom edge of the opening) to 1 (top edge). */
    up: doublePrecision('up').notNull(),
    /** 0 (front) to 9 (back): `DEPTH_TICKS` in the shared package. */
    depthTick: integer('depth_tick').notNull(),
    /** `SCENE_SCALE` in the shared package. */
    scale: doublePrecision('scale').notNull().default(1),
    flipped: boolean('flipped').notNull().default(false),
    /** A prop placed but not shown yet is false; so is every puppet. */
    shown: boolean('shown').notNull(),
    /** A prop's stand or string; null for a puppet, which is on a stick. */
    mount: propMount('mount'),
    /** A puppet's travel in a transition scene (F5.4): walking unless set; null for a prop. */
    travelMode: travelMode('travel_mode'),
    /** Its place in the scene's list. */
    position: integer('position').notNull(),
  },
  (table) => [
    index('scene_objects_scene_id_position_idx').on(table.sceneId, table.position),
    /** The cascade when a record is deleted. */
    index('scene_objects_record_id_idx').on(table.recordId),
    index('scene_objects_campaign_id_idx').on(table.campaignId),
    /** An NPC is in a scene once; a prop may be placed several times (three barrels). */
    uniqueIndex('scene_objects_puppet_unique')
      .on(table.sceneId, table.recordId)
      .where(sql`${table.kind} = 'puppet'`),
    check(
      'scene_objects_inside_opening',
      sql`${table.across} between 0 and 1 and ${table.up} between 0 and 1`,
    ),
    check('scene_objects_depth_tick', sql`${table.depthTick} between 0 and 9`),
    check('scene_objects_scale', sql`${table.scale} between 0.25 and 2.5`),
    check('scene_objects_position', sql`${table.position} >= 0`),
    check('scene_objects_puppets_lowered', sql`${table.kind} = 'prop' or not ${table.shown}`),
    check(
      'scene_objects_mount_only_props',
      sql`(${table.kind} = 'prop') = (${table.mount} is not null)`,
    ),
    check(
      'scene_objects_travel_mode_only_puppets',
      sql`(${table.kind} = 'puppet') = (${table.travelMode} is not null)`,
    ),
  ],
);

/**
 * A scene's likely next scenes (F5.2, 19.28): the scenes it probably leads to, in the GM's order,
 * which the desk lists first while it is loaded. A scene lists another at most once and never
 * itself; deleting either scene removes the row. Both scenes are in `campaign_id`: checked by
 * the data layer.
 */
export const sceneNext = pgTable(
  'scene_next',
  {
    sceneId: uuid('scene_id')
      .notNull()
      .references(() => scenes.id, { onDelete: 'cascade' }),
    nextSceneId: uuid('next_scene_id')
      .notNull()
      .references(() => scenes.id, { onDelete: 'cascade' }),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    /** Its place in the scene's list. */
    position: integer('position').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.sceneId, table.nextSceneId] }),
    /** The cascade when the next scene is deleted. */
    index('scene_next_next_scene_id_idx').on(table.nextSceneId),
    index('scene_next_campaign_id_idx').on(table.campaignId),
    check('scene_next_not_itself', sql`${table.sceneId} <> ${table.nextSceneId}`),
    check('scene_next_position', sql`${table.position} >= 0`),
  ],
);
