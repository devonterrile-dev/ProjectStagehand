/**
 * Live sessions (F3.3, governance §8 and §13): one play night of a campaign, and the theater as
 * it stands right now. Not `sessions`: Better Auth owns that table name.
 *
 * The live stage is a copy. Loading a scene copies its Spot and its objects here, and from then
 * on the copy changes on its own (the control desk, F3.4): editing the saved scene in the
 * builder mid-session changes nothing on stage. The copy keeps each object's id (D-49), so the
 * primary key is the session and the object together.
 *
 * Here `shown` is a prop that is in sight or a puppet that is raised, so a puppet may be shown,
 * unlike in a saved scene. Players are sent only what is shown. An object is a record or, added
 * live, a PC's puppet (F3.4).
 *
 * A session's objects are deleted when it ends: they are the stage, not a record of the night.
 * Its events stay: they are the record of the night (§8 `session_events`).
 * Only `src/campaigns/play-sessions.ts` queries these tables.
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { users } from './auth';
import { campaigns, characters } from './campaigns';
import { records } from './records';
import { propMount, sceneObjectKind, scenes } from './scenes';

export const playSessions = pgTable(
  'play_sessions',
  {
    id: uuid('id')
      .default(sql`pg_catalog.gen_random_uuid()`)
      .primaryKey(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    /** 1 for the campaign's first session, then 2, 3… */
    number: integer('number').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
    /** Null while the session is running. */
    endedAt: timestamp('ended_at', { withTimezone: true }),
    /** The scene that was loaded last, for its name. Deleting the scene leaves the stage as is. */
    sceneId: uuid('scene_id').references(() => scenes.id, { onDelete: 'set null' }),
    /** The loaded scene's Spot, copied at the load: its image in use is the backdrop. */
    spotId: uuid('spot_id').references(() => records.id, { onDelete: 'set null' }),
    /** How many scenes have been loaded: browsers change scene behind the curtain when it moves. */
    sceneLoads: integer('scene_loads').default(0).notNull(),
    curtainOpen: boolean('curtain_open').default(false).notNull(),
    /** The GM's Fear (§9). Set from the ruleset at the start; first used by F3.6. */
    fear: integer('fear').notNull(),
  },
  (table) => [
    uniqueIndex('play_sessions_campaign_number_unique').on(table.campaignId, table.number),
    /** One running session per campaign. */
    uniqueIndex('play_sessions_one_active')
      .on(table.campaignId)
      .where(sql`${table.endedAt} is null`),
    /** The set-nulls when a scene or a Spot is deleted. */
    index('play_sessions_scene_id_idx').on(table.sceneId),
    index('play_sessions_spot_id_idx').on(table.spotId),
    check('play_sessions_number', sql`${table.number} >= 1`),
    check('play_sessions_scene_loads', sql`${table.sceneLoads} >= 0`),
    check('play_sessions_fear', sql`${table.fear} >= 0`),
  ],
);

export const playSessionObjects = pgTable(
  'play_session_objects',
  {
    playSessionId: uuid('play_session_id')
      .notNull()
      .references(() => playSessions.id, { onDelete: 'cascade' }),
    /** The scene object's own id, kept by the copy. */
    id: uuid('id').notNull(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    kind: sceneObjectKind('kind').notNull(),
    /**
     * A Prop or Item for a prop, an NPC for a puppet. Deleting it takes the object along. Null
     * for a PC's puppet.
     */
    recordId: uuid('record_id').references(() => records.id, { onDelete: 'cascade' }),
    /** A PC's puppet, added live by the GM (F3.4). Deleting the PC takes the puppet along. */
    characterId: uuid('character_id').references(() => characters.id, { onDelete: 'cascade' }),
    across: doublePrecision('across').notNull(),
    up: doublePrecision('up').notNull(),
    depthTick: integer('depth_tick').notNull(),
    scale: doublePrecision('scale').notNull().default(1),
    flipped: boolean('flipped').notNull().default(false),
    /** A prop in sight, or a puppet raised. False: players are sent nothing of it. */
    shown: boolean('shown').notNull(),
    /** A prop's stand or string; null for a puppet, which is on a stick. */
    mount: propMount('mount'),
    /** Its place in the stage's list. */
    position: integer('position').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.playSessionId, table.id] }),
    index('play_session_objects_session_position_idx').on(table.playSessionId, table.position),
    /** The cascade when a record is deleted. */
    index('play_session_objects_record_id_idx').on(table.recordId),
    index('play_session_objects_character_id_idx').on(table.characterId),
    index('play_session_objects_campaign_id_idx').on(table.campaignId),
    /** An NPC is on the stage once; a prop record can be placed several times. */
    uniqueIndex('play_session_objects_npc_unique')
      .on(table.playSessionId, table.recordId)
      .where(sql`${table.kind} = 'puppet' and ${table.recordId} is not null`),
    /** A PC is on the stage once. */
    uniqueIndex('play_session_objects_pc_unique')
      .on(table.playSessionId, table.characterId)
      .where(sql`${table.characterId} is not null`),
    check(
      'play_session_objects_one_subject',
      sql`(${table.recordId} is null) <> (${table.characterId} is null)`,
    ),
    check(
      'play_session_objects_pc_is_puppet',
      sql`${table.characterId} is null or ${table.kind} = 'puppet'`,
    ),
    check(
      'play_session_objects_inside_opening',
      sql`${table.across} between 0 and 1 and ${table.up} between 0 and 1`,
    ),
    check('play_session_objects_depth_tick', sql`${table.depthTick} between 0 and 9`),
    check('play_session_objects_scale', sql`${table.scale} between 0.25 and 2.5`),
    check('play_session_objects_position', sql`${table.position} >= 0`),
    check(
      'play_session_objects_mount_only_props',
      sql`(${table.kind} = 'prop') = (${table.mount} is not null)`,
    ),
  ],
);

/** What a session's log holds so far (F3.4). Rolls and Hope and Fear arrive with F3.6. */
export const SESSION_EVENT_KINDS = ['scene_load', 'reveal', 'unreveal'] as const;
export const sessionEventKind = pgEnum('session_event_kind', SESSION_EVENT_KINDS);

/**
 * A session's log (governance §8, F4.3 recap): append-only, never updated. Kept when the session
 * ends. `actor_user_id` is null for what the stage did by itself (a record revealed as it came
 * into sight); `data` holds what the kind needs beyond its record, such as a loaded scene's name.
 */
export const sessionEvents = pgTable(
  'session_events',
  {
    id: uuid('id')
      .default(sql`pg_catalog.gen_random_uuid()`)
      .primaryKey(),
    playSessionId: uuid('play_session_id')
      .notNull()
      .references(() => playSessions.id, { onDelete: 'cascade' }),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    kind: sessionEventKind('kind').notNull(),
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    recordId: uuid('record_id').references(() => records.id, { onDelete: 'set null' }),
    data: jsonb('data').$type<Record<string, unknown>>().default({}).notNull(),
    at: timestamp('at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('session_events_session_at_idx').on(table.playSessionId, table.at),
    index('session_events_campaign_id_idx').on(table.campaignId),
    /** The set-nulls when a user or a record is deleted. */
    index('session_events_actor_user_id_idx').on(table.actorUserId),
    index('session_events_record_id_idx').on(table.recordId),
  ],
);
