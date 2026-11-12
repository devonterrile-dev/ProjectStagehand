/**
 * AI note imports (F1.8, governance §8 and §10, D-27). An `ai_imports` row is one brain-dump
 * sent to the model: what the GM wrote, which prompt and model answered, what it cost and
 * how it ended. Its `ai_proposals` are what the model proposed, each with the GM's verdict;
 * nothing touches `records` until the import is committed.
 *
 * `input_text` and the proposal payloads hold private campaign text. They never go to a log,
 * and only the campaign's GM reads them (through `src/campaigns/ai-imports.ts`, the only
 * code that queries these tables).
 */
import {
  IMPORT_MODES,
  IMPORT_STATUSES,
  PROPOSAL_ACTIONS,
  PROPOSAL_REVIEW_STATES,
  type ImportErrorCode,
  type ImportPhase,
  type ImportRound,
  type RecordType,
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
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { users } from './auth';
import { campaigns } from './campaigns';

export const aiImportMode = pgEnum('ai_import_mode', IMPORT_MODES);
export const aiImportStatus = pgEnum('ai_import_status', IMPORT_STATUSES);
export const aiProposalAction = pgEnum('ai_proposal_action', PROPOSAL_ACTIONS);
export const aiProposalReviewState = pgEnum('ai_proposal_review_state', PROPOSAL_REVIEW_STATES);

export const aiImports = pgTable(
  'ai_imports',
  {
    id: uuid('id')
      .default(sql`pg_catalog.gen_random_uuid()`)
      .primaryKey(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    /** The GM who started it, whose key paid for it. */
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    mode: aiImportMode('mode').notNull(),
    /** The record types the GM limited new records to; null = no filter. */
    targetTypes: jsonb('target_types').$type<RecordType[]>(),
    /**
     * `fill` mode: the record being completed. Not a foreign key: the import stays as a
     * usage record if the record is deleted later.
     */
    fillRecordId: uuid('fill_record_id'),
    /** The GM's brain-dump, kept so a failed import can be tried again. */
    inputText: text('input_text').notNull(),
    promptVersion: integer('prompt_version').notNull(),
    /** The model asked for, replaced by the one that answered. */
    model: text('model').notNull(),
    status: aiImportStatus('status').notNull().default('running'),
    /**
     * The model call running now, or the last one (D-30): `questions` first, then `records`.
     * Imports from before the questions step were records-only.
     */
    phase: text('phase').$type<ImportPhase>().notNull().default('records'),
    /** Earlier rounds of questions and the GM's answers, oldest first. */
    conversation: jsonb('conversation').$type<ImportRound[]>().notNull().default([]),
    /** Model steps started: question rounds, the records call and retries. */
    steps: integer('steps').notNull().default(1),
    /** Set when `status` is `failed`. */
    errorCode: text('error_code').$type<ImportErrorCode>(),
    /** Validation problems or the provider's message, for the GM. */
    errorDetails: jsonb('error_details').$type<string[]>(),
    /** The questions waiting for the GM, or those the records call left open. */
    questions: jsonb('questions').$type<string[]>().notNull().default([]),
    /** Model calls of the last step: 0 until the first returns, 2 after a retry. */
    attempts: integer('attempts').notNull().default(0),
    /** Token usage over every step and attempt, as Anthropic reported it. */
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    cacheReadTokens: integer('cache_read_tokens').notNull().default(0),
    cacheWriteTokens: integer('cache_write_tokens').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    /** When the model call ended, with proposals or a failure. */
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    committedAt: timestamp('committed_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    /** The campaign's import list, newest first. */
    index('ai_imports_campaign_id_created_at_idx').on(table.campaignId, table.createdAt),
    /** The GM's usage page and the imports-per-hour count. */
    index('ai_imports_user_id_created_at_idx').on(table.userId, table.createdAt),
    /** One import in flight per GM (§10 cost guardrails): a second insert fails. */
    uniqueIndex('ai_imports_one_running_per_user')
      .on(table.userId)
      .where(sql`${table.status} = 'running'`),
    /** Target of the proposals' foreign key. */
    unique('ai_imports_id_campaign_id_unique').on(table.id, table.campaignId),
    check(
      'ai_imports_error_only_failed',
      sql`(${table.status} = 'failed') = (${table.errorCode} is not null)`,
    ),
    check('ai_imports_attempts_check', sql`${table.attempts} between 0 and 2`),
    check('ai_imports_phase_check', sql`${table.phase} in ('questions', 'records')`),
  ],
);

export const aiProposals = pgTable(
  'ai_proposals',
  {
    id: uuid('id')
      .default(sql`pg_catalog.gen_random_uuid()`)
      .primaryKey(),
    importId: uuid('import_id').notNull(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    /** Order on the review screen: creates, then updates, then links. */
    position: integer('position').notNull(),
    action: aiProposalAction('action').notNull(),
    /** The proposal as it stands, after any edits; its shape is `proposalPayloadSchemas[action]`. */
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    /** The proposal as the model made it. */
    originalPayload: jsonb('original_payload').$type<Record<string, unknown>>().notNull(),
    reviewState: aiProposalReviewState('review_state').notNull().default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    /** A proposal belongs to an import of the same campaign, and goes when it goes. */
    foreignKey({
      name: 'ai_proposals_import_fk',
      columns: [table.importId, table.campaignId],
      foreignColumns: [aiImports.id, aiImports.campaignId],
    }).onDelete('cascade'),
    unique('ai_proposals_import_id_position_unique').on(table.importId, table.position),
  ],
);
