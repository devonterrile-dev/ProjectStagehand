/**
 * Visual assets (F2.3, governance §8 and §11, D-42). One row per try at an image for a record
 * (NPC, Prop, Item, Spot) or a PC: the prompt that was sent, which style bible and model made
 * it, what it cost, where its file is, and how far it got. The record's or PC's
 * `visual_asset_id` points at the one in use.
 *
 * `prompt` holds private campaign text (a record's appearance and GM-written fields). It never
 * goes to a log, and only the campaign's GM reads it, through `src/campaigns/visuals.ts`, the
 * only code that queries this table.
 */
import {
  ASSET_KINDS,
  ASSET_STATUSES,
  type ImageAspectRatio,
  type ImageQuality,
  type VisualErrorCode,
} from '@stagehand/shared';
import { sql } from 'drizzle-orm';
import {
  check,
  doublePrecision,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import { users } from './auth';
import { campaigns, characters } from './campaigns';
import { records } from './records';

export const assetKind = pgEnum('asset_kind', ASSET_KINDS);
export const assetStatus = pgEnum('asset_status', ASSET_STATUSES);

export const assets = pgTable(
  'assets',
  {
    id: uuid('id')
      .default(sql`pg_catalog.gen_random_uuid()`)
      .primaryKey(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    /**
     * The record it was made for. Cleared, not cascaded, when the record goes: old assets are
     * kept (§11) for the asset library (F2.7). Same campaign, checked by the data layer.
     */
    recordId: uuid('record_id').references(() => records.id, { onDelete: 'set null' }),
    /** Or the PC it was made for (check below: never both). */
    characterId: uuid('character_id').references(() => characters.id, { onDelete: 'set null' }),
    /** The GM who asked for it, whose OpenRouter key pays for it. */
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: assetKind('kind').notNull(),
    status: assetStatus('status').notNull().default('generating'),
    /** Set when `status` is `failed`. */
    errorCode: text('error_code').$type<VisualErrorCode>(),
    /** The full text prompt sent to the image model. Private campaign text: never logged. */
    prompt: text('prompt').notNull(),
    /** The OpenRouter model slug. */
    model: text('model').notNull(),
    styleBibleVersion: integer('style_bible_version').notNull(),
    quality: text('quality').$type<ImageQuality>().notNull(),
    aspectRatio: text('aspect_ratio').$type<ImageAspectRatio>().notNull(),
    /** The GM's notes for a regeneration (F2.5). */
    revisionNotes: text('revision_notes'),
    /** Storage key of the image exactly as the model sent it. Set once it is `pending`. */
    originalPath: text('original_path'),
    /** Storage key of the post-processed image, always WebP (F2.4, D-43). */
    processedPath: text('processed_path'),
    /** Its size: a cutout's stick or stand is fixed at its bottom center. */
    processedWidth: integer('processed_width'),
    processedHeight: integer('processed_height'),
    /** The post-processing version that made it; older ones are made again at startup. */
    processingVersion: integer('processing_version'),
    mediaType: text('media_type'),
    /** What OpenRouter charged, in USD, when it said. */
    costUsd: doublePrecision('cost_usd'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    /** When a worker picked the job up. A `generating` row with this set was cut off by a restart. */
    startedAt: timestamp('started_at', { withTimezone: true }),
    /** When the image came back, or the try failed. */
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    /** A record's tries, newest first. */
    index('assets_record_id_created_at_idx').on(table.recordId, table.createdAt),
    /** A PC's tries, newest first. */
    index('assets_character_id_created_at_idx').on(table.characterId, table.createdAt),
    /** The per-GM limits (§11 cost guardrails). */
    index('assets_created_by_created_at_idx').on(table.createdBy, table.createdAt),
    index('assets_campaign_id_idx').on(table.campaignId),
    check('assets_one_subject', sql`num_nonnulls(${table.recordId}, ${table.characterId}) <= 1`),
    check(
      'assets_error_only_failed',
      sql`(${table.status} = 'failed') = (${table.errorCode} is not null)`,
    ),
    check(
      'assets_image_once_made',
      sql`${table.status} in ('generating', 'failed') or ${table.originalPath} is not null`,
    ),
    check(
      'assets_processed_complete',
      sql`num_nonnulls(${table.processedPath}, ${table.processedWidth}, ${table.processedHeight}, ${table.processingVersion}) in (0, 4)`,
    ),
  ],
);
