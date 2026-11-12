/**
 * AI note imports (F1.8, governance §10, D-27). Part of the campaign data-access layer:
 * every query is scoped to `scope.campaignId`, so an import or proposal id from another
 * campaign is never found. The only code that queries `ai_imports` and `ai_proposals`.
 *
 * An import starts `running` in the `questions` phase (D-30). When the model asks something
 * it waits as `questions` until the GM answers (another `questions` step) or asks for the
 * records (the `records` step); when it asks nothing, the job goes straight on to the
 * records. The records step ends `ready` (or `failed`), and the GM then commits or discards
 * the import. Nothing touches `records` before `commitImport`, which saves every accepted
 * proposal in one transaction.
 *
 * Callers check `assertGm` and `assertWritable`. Nothing here logs: the rows hold the GM's
 * notes and the model's answer.
 */
import {
  AI_IMPORT_LIMITS,
  createProposalPayloadSchema,
  createRecordRequestSchema,
  estimateCostUsd,
  IMPORT_ERROR_MESSAGES,
  linkFieldSpec,
  linkProposalPayloadSchema,
  TAGS_MAX,
  updateProposalPayloadSchema,
  type CommitImportResponse,
  type CreateProposalPayload,
  type ImportDetail,
  type ImportPhase,
  type ImportProposal,
  type ImportRound,
  type ImportSummary,
  type LinkProposalPayload,
  type PatchProposalRequest,
  type PatchProposalResponse,
  type ProposalRefs,
  type ProposalReviewState,
  type RecordRef,
  type RecordType,
  type StartImportRequest,
  type TokenUsage,
  type UpdateBefore,
  type UpdateProposalPayload,
  type UpdateRecordRequest,
  type UsageResponse,
} from '@stagehand/shared';
import { and, asc, count, desc, eq, getTableColumns, gt, inArray, lt, ne, sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import type { z } from 'zod';

import { emptyContextPack } from '../ai-import/context';
import { buildContextPack, type BuiltPack } from '../ai-import/context-pack';
import type { GenerateResult } from '../ai-import/generate';
import type { Database } from '../db/client';
import { aiImports, aiProposals, campaigns, recordLinks, records } from '../db/schema';
import { httpError } from '../http/errors';

import type { DbOrTx } from './members';
import { addFieldLinks, addOtherLink, recordTypesIn } from './record-links';
import { insertRecordRow, linkNewRecord, updateRecordRow } from './records';
import type { CampaignScope } from './scope';

type ImportRow = typeof aiImports.$inferSelect;
type ProposalRow = typeof aiProposals.$inferSelect;

const TEXT_PREVIEW_MAX = 140;
/** Longer than the model call's own timeout, retries included. */
const RUNNING_MAX_MS = 45 * 60 * 1000;
/** Most possible duplicates shown on one proposal. */
const DUPLICATES_MAX = 3;

/** `id = importId and campaign_id = scope.campaignId`. */
function scopedImport(scope: CampaignScope, importId: string) {
  return and(eq(aiImports.id, importId), eq(aiImports.campaignId, scope.campaignId));
}

/** The proposals of one import of this campaign. */
function proposalsOf(scope: CampaignScope, importId: string) {
  return and(eq(aiProposals.importId, importId), eq(aiProposals.campaignId, scope.campaignId));
}

// ---------------------------------------------------------------------------
// Starting and finishing an import.
// ---------------------------------------------------------------------------

/**
 * What the model will be told about the campaign for this request (§10 step 2). Also checks
 * that the mode fits the campaign: `bootstrap` needs an empty one (409), and `fill` a record
 * of this campaign (404).
 */
export async function prepareImport(
  db: Database,
  scope: CampaignScope,
  request: StartImportRequest,
  options: { laterStep?: boolean } = {},
): Promise<BuiltPack> {
  const rows = await db
    .select({
      id: records.id,
      type: records.type,
      name: records.name,
      parentId: records.parentId,
      tags: records.tags,
      publicDescription: records.publicDescription,
      gmNotes: records.gmNotes,
      fields: records.fields,
    })
    .from(records)
    .where(eq(records.campaignId, scope.campaignId));

  if (request.mode === 'bootstrap') {
    // A later step of a bootstrap import stays a bootstrap, even if records appeared since.
    if (rows.length > 0 && options.laterStep !== true) {
      throw httpError(409, 'This campaign already has records. Add to the campaign instead.');
    }
    return { pack: emptyContextPack(), levels: { index: 0, summary: 0, full: 0 } };
  }
  const fillTargetId = request.mode === 'fill' ? (request.recordId ?? null) : null;
  if (fillTargetId !== null && !rows.some((row) => row.id === fillTargetId)) {
    throw httpError(404, 'Record not found');
  }

  const links = await db
    .select({
      fromId: recordLinks.fromRecordId,
      toId: recordLinks.toRecordId,
      fieldKey: recordLinks.fieldKey,
      label: recordLinks.label,
    })
    .from(recordLinks)
    .where(
      and(
        eq(recordLinks.campaignId, scope.campaignId),
        inArray(recordLinks.kind, ['field', 'other']),
      ),
    );
  return buildContextPack({ records: rows, links, text: request.text, fillTargetId });
}

/**
 * Records a new import as `running`. Refused with 429 when the GM has started too many in
 * the last hour, and with 409 while another of theirs is still running (§10 cost guardrails;
 * the database enforces the second with a unique index).
 */
export async function startImport(
  db: Database,
  scope: CampaignScope,
  request: StartImportRequest,
  meta: { promptVersion: number; model: string },
): Promise<ImportSummary> {
  // An import that has been running longer than any model call can last was orphaned (its
  // job died without recording why). Clear it, or it would block the GM until a restart.
  await db
    .update(aiImports)
    .set({ status: 'failed', errorCode: 'interrupted', errorDetails: [], finishedAt: new Date() })
    .where(
      and(
        eq(aiImports.userId, scope.userId),
        eq(aiImports.status, 'running'),
        // A later step starts long after the import was created, so its own start counts.
        lt(aiImports.updatedAt, new Date(Date.now() - RUNNING_MAX_MS)),
      ),
    );

  const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const [recent] = await db
    .select({ n: count() })
    .from(aiImports)
    .where(and(eq(aiImports.userId, scope.userId), gt(aiImports.createdAt, hourAgo)));
  if ((recent?.n ?? 0) >= AI_IMPORT_LIMITS.importsPerHour) {
    throw httpError(
      429,
      `You've started ${String(AI_IMPORT_LIMITS.importsPerHour)} imports in the last hour. Try again later.`,
    );
  }

  const [row] = await db
    .insert(aiImports)
    .values({
      campaignId: scope.campaignId,
      userId: scope.userId,
      mode: request.mode,
      targetTypes: request.targetTypes ?? null,
      fillRecordId: request.mode === 'fill' ? (request.recordId ?? null) : null,
      inputText: request.text,
      phase: 'questions',
      promptVersion: meta.promptVersion,
      model: meta.model,
    })
    .onConflictDoNothing()
    .returning();
  if (row === undefined) {
    throw httpError(409, 'Another import of yours is still running. Wait for it to finish.');
  }
  return toSummary(row, new Map());
}

/** Adds a step's usage to what the import's earlier steps used. */
function addedUsage(usage: TokenUsage) {
  return {
    inputTokens: sql`${aiImports.inputTokens} + ${usage.inputTokens}`,
    outputTokens: sql`${aiImports.outputTokens} + ${usage.outputTokens}`,
    cacheReadTokens: sql`${aiImports.cacheReadTokens} + ${usage.cacheReadTokens}`,
    cacheWriteTokens: sql`${aiImports.cacheWriteTokens} + ${usage.cacheWriteTokens}`,
  };
}

interface ImportIds {
  importId: string;
  campaignId: string;
}

/** The import while one of its steps is in flight, as the background job names it. */
function runningStep(ids: ImportIds, phase: ImportPhase) {
  return and(
    eq(aiImports.id, ids.importId),
    eq(aiImports.campaignId, ids.campaignId),
    eq(aiImports.status, 'running'),
    eq(aiImports.phase, phase),
  );
}

/**
 * Stores how a step ended: the model's questions (status `questions`), its proposals and any
 * questions left open (`ready`), or why it failed. Called by the background job, which holds
 * no campaign scope, so the import is named by both its ids. An import that is no longer
 * running this step is left alone.
 */
export async function finishImport(
  db: Database,
  ids: ImportIds,
  phase: ImportPhase,
  result: GenerateResult,
): Promise<void> {
  await db.transaction(async (tx) => {
    const status = !result.ok ? 'failed' : phase === 'questions' ? 'questions' : 'ready';
    const [row] = await tx
      .update(aiImports)
      .set({
        status,
        errorCode: result.ok ? null : result.error,
        errorDetails: result.ok ? null : result.details,
        questions: result.ok ? result.questions : [],
        model: result.model,
        attempts: result.attempts,
        ...addedUsage(result.usage),
        finishedAt: new Date(),
      })
      .where(runningStep(ids, phase))
      .returning({ id: aiImports.id });
    if (row === undefined || !result.ok || phase !== 'records' || result.proposals.length === 0) {
      return;
    }

    await tx.insert(aiProposals).values(
      result.proposals.map((proposal, position) => ({
        importId: ids.importId,
        campaignId: ids.campaignId,
        position,
        action: proposal.action,
        payload: proposal.payload,
        originalPayload: proposal.payload,
      })),
    );
  });
}

/**
 * A questions step that asked nothing goes straight on to the records (D-30): its usage is
 * kept and the import stays `running`, now in the `records` phase. False when the import is
 * no longer running that step.
 */
export async function continueToRecords(
  db: Database,
  ids: ImportIds,
  result: Extract<GenerateResult, { ok: true }>,
): Promise<boolean> {
  const rows = await db
    .update(aiImports)
    .set({
      phase: 'records',
      model: result.model,
      attempts: result.attempts,
      steps: sql`${aiImports.steps} + 1`,
      ...addedUsage(result.usage),
    })
    .where(runningStep(ids, 'questions'))
    .returning({ id: aiImports.id });
  return rows.length > 0;
}

/** What one step is run with, read from the import: its notes, mode and earlier rounds. */
export interface StepInputs {
  mode: ImportRow['mode'];
  phase: ImportPhase;
  text: string;
  targetTypes: ImportRow['targetTypes'];
  recordId: string | null;
  conversation: ImportRound[];
  /** The questions waiting for an answer, before the step starts. */
  pending: string[];
}

function stepInputs(row: ImportRow): StepInputs {
  return {
    mode: row.mode,
    phase: row.phase,
    text: row.inputText,
    targetTypes: row.targetTypes,
    recordId: row.fillRecordId,
    conversation: row.conversation,
    pending: row.status === 'questions' ? row.questions : [],
  };
}

/** What a step of this import would be run with, read before it starts. 404 if not found. */
export async function importStepInputs(
  db: Database,
  scope: CampaignScope,
  importId: string,
): Promise<StepInputs> {
  return stepInputs(await requireImport(db, scope, importId));
}

/** True for Postgres's unique_violation, however drizzle wraps it. */
function isUniqueViolation(error: unknown): boolean {
  const wrapped = error as { code?: unknown; cause?: { code?: unknown } } | null;
  return (wrapped?.cause?.code ?? wrapped?.code) === '23505';
}

const ANOTHER_RUNNING = 'Another import of yours is still running. Wait for it to finish.';

/** The states a step starts from, and why it can't start from each other state. */
const STEP_REFUSALS = {
  questions: {
    running: 'This import is still running.',
    ready: "Claude has already written this import's records.",
    failed: 'This import failed. Try it again instead.',
    committed: 'This import has already been saved.',
    discarded: 'This import was discarded.',
  },
  failed: {
    running: 'This import is still running.',
    questions: "This import didn't fail: it's waiting for your answers.",
    ready: "This import didn't fail: it's ready to review.",
    committed: 'This import has already been saved.',
    discarded: 'This import was discarded.',
  },
} satisfies {
  [From in 'questions' | 'failed']: Record<Exclude<ImportRow['status'], From>, string>;
};

/**
 * Starts the next step of an import (D-30): `next` turns the locked row into the step's
 * phase and conversation. 404 if the import isn't this campaign's; 409 when it isn't in the
 * `from` state, when it has taken all its steps, or while another import of the GM's runs.
 */
async function startStep(
  db: Database,
  scope: CampaignScope,
  importId: string,
  from: keyof typeof STEP_REFUSALS,
  next: (row: ImportRow) => { phase: ImportPhase; conversation: ImportRound[] },
): Promise<{ summary: ImportSummary; inputs: StepInputs }> {
  try {
    const row = await db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(aiImports)
        .where(scopedImport(scope, importId))
        .for('update');
      if (current === undefined) throw httpError(404, 'Import not found');
      if (current.status !== from) {
        const refusals: Partial<Record<ImportRow['status'], string>> = STEP_REFUSALS[from];
        throw httpError(409, refusals[current.status] ?? 'This import has moved on.');
      }
      if (current.steps >= AI_IMPORT_LIMITS.stepsPerImport) {
        throw httpError(
          409,
          `This import has used all ${String(AI_IMPORT_LIMITS.stepsPerImport)} of its steps. Start a new import to go on.`,
        );
      }
      const [other] = await tx
        .select({ id: aiImports.id })
        .from(aiImports)
        .where(
          and(
            eq(aiImports.userId, scope.userId),
            eq(aiImports.status, 'running'),
            ne(aiImports.id, importId),
          ),
        );
      if (other !== undefined) throw httpError(409, ANOTHER_RUNNING);

      const { phase, conversation } = next(current);
      const [updated] = await tx
        .update(aiImports)
        .set({
          status: 'running',
          phase,
          conversation,
          questions: [],
          errorCode: null,
          errorDetails: null,
          attempts: 0,
          steps: sql`${aiImports.steps} + 1`,
          finishedAt: null,
        })
        .where(scopedImport(scope, importId))
        .returning();
      if (updated === undefined) throw httpError(404, 'Import not found');
      return updated;
    });
    return { summary: toSummary(row, new Map()), inputs: stepInputs(row) };
  } catch (error) {
    // Another of the GM's imports started between the check and the update.
    if (isUniqueViolation(error)) throw httpError(409, ANOTHER_RUNNING);
    throw error;
  }
}

/** The GM answers the waiting questions; the model reads them and may ask more. */
export function answerQuestions(
  db: Database,
  scope: CampaignScope,
  importId: string,
  answer: string,
): Promise<{ summary: ImportSummary; inputs: StepInputs }> {
  return startStep(db, scope, importId, 'questions', (row) => ({
    phase: 'questions',
    conversation: [...row.conversation, { questions: row.questions, answer }],
  }));
}

/** The GM stops the questions and asks for the records, with a last answer if they wrote one. */
export function beginRecords(
  db: Database,
  scope: CampaignScope,
  importId: string,
  answer: string | null,
): Promise<{ summary: ImportSummary; inputs: StepInputs }> {
  return startStep(db, scope, importId, 'questions', (row) => ({
    phase: 'records',
    conversation: [...row.conversation, { questions: row.questions, answer }],
  }));
}

/** Runs a failed step again, with the same notes and answers. */
export function retryImport(
  db: Database,
  scope: CampaignScope,
  importId: string,
): Promise<{ summary: ImportSummary; inputs: StepInputs }> {
  return startStep(db, scope, importId, 'failed', (row) => ({
    phase: row.phase,
    conversation: row.conversation,
  }));
}

/**
 * Marks every import still `running` as failed. Run once at startup: the model calls live in
 * the server process, so none of them survived the restart. Returns how many there were.
 */
export async function failInterruptedImports(db: Database): Promise<number> {
  const rows = await db
    .update(aiImports)
    .set({ status: 'failed', errorCode: 'interrupted', errorDetails: [], finishedAt: new Date() })
    .where(eq(aiImports.status, 'running'))
    .returning({ id: aiImports.id });
  return rows.length;
}

// ---------------------------------------------------------------------------
// Reading imports.
// ---------------------------------------------------------------------------

type ProposalCounts = Map<string, ImportSummary['proposalCounts']>;

async function proposalCounts(
  db: DbOrTx,
  scope: CampaignScope,
  importIds: readonly string[],
): Promise<ProposalCounts> {
  const counts: ProposalCounts = new Map();
  if (importIds.length === 0) return counts;
  const rows = await db
    .select({ importId: aiProposals.importId, action: aiProposals.action, n: count() })
    .from(aiProposals)
    .where(
      and(
        eq(aiProposals.campaignId, scope.campaignId),
        inArray(aiProposals.importId, [...importIds]),
      ),
    )
    .groupBy(aiProposals.importId, aiProposals.action);
  for (const row of rows) {
    const entry = counts.get(row.importId) ?? { create: 0, update: 0, link: 0 };
    entry[row.action] = row.n;
    counts.set(row.importId, entry);
  }
  return counts;
}

function usageOf(row: Pick<ImportRow, keyof TokenUsage>): TokenUsage {
  return {
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    cacheReadTokens: row.cacheReadTokens,
    cacheWriteTokens: row.cacheWriteTokens,
  };
}

function toSummary(row: ImportRow, counts: ProposalCounts): ImportSummary {
  const usage = usageOf(row);
  const preview = row.inputText.replace(/\s+/g, ' ').trim();
  return {
    id: row.id,
    campaignId: row.campaignId,
    mode: row.mode,
    status: row.status,
    phase: row.phase,
    steps: row.steps,
    targetTypes: row.targetTypes,
    recordId: row.fillRecordId,
    promptVersion: row.promptVersion,
    model: row.model,
    attempts: row.attempts,
    usage,
    estimatedCostUsd: estimateCostUsd(row.model, usage),
    error:
      row.errorCode === null
        ? null
        : {
            code: row.errorCode,
            message: IMPORT_ERROR_MESSAGES[row.errorCode],
            details: row.errorDetails ?? [],
          },
    textPreview:
      preview.length <= TEXT_PREVIEW_MAX ? preview : `${preview.slice(0, TEXT_PREVIEW_MAX)}…`,
    proposalCounts: counts.get(row.id) ?? { create: 0, update: 0, link: 0 },
    createdAt: row.createdAt.toISOString(),
    // A running import's row last changed when its step started.
    stepStartedAt: row.status === 'running' ? row.updatedAt.toISOString() : null,
    finishedAt: row.finishedAt?.toISOString() ?? null,
    committedAt: row.committedAt?.toISOString() ?? null,
  };
}

/** The campaign's imports, newest first, without their full text or proposals. */
export async function listImports(db: Database, scope: CampaignScope): Promise<ImportSummary[]> {
  const rows = await db
    .select({
      ...getTableColumns(aiImports),
      // Only the start of the notes is shown in a list.
      inputText: sql<string>`left(${aiImports.inputText}, ${TEXT_PREVIEW_MAX * 2})`,
    })
    .from(aiImports)
    .where(eq(aiImports.campaignId, scope.campaignId))
    .orderBy(desc(aiImports.createdAt), desc(aiImports.id))
    .limit(AI_IMPORT_LIMITS.listMax);
  const counts = await proposalCounts(
    db,
    scope,
    rows.map((row) => row.id),
  );
  return rows.map((row) => toSummary(row, counts));
}

async function requireImport(
  db: DbOrTx,
  scope: CampaignScope,
  importId: string,
): Promise<ImportRow> {
  const [row] = await db.select().from(aiImports).where(scopedImport(scope, importId));
  if (row === undefined) throw httpError(404, 'Import not found');
  return row;
}

/** One import with its notes, the model's questions and every proposal as a review card. */
export async function getImport(
  db: Database,
  scope: CampaignScope,
  importId: string,
): Promise<ImportDetail> {
  const row = await requireImport(db, scope, importId);
  const { proposals, refs } = await proposalViews(db, scope, row);
  const counts = await proposalCounts(db, scope, [row.id]);
  return {
    ...toSummary(row, counts),
    text: row.inputText,
    questions: row.questions,
    conversation: row.conversation,
    proposals,
    refs,
  };
}

/** A proposal row with its payloads typed by its action. */
type TypedProposal =
  | { row: ProposalRow; action: 'create'; payload: CreateProposalPayload }
  | { row: ProposalRow; action: 'update'; payload: UpdateProposalPayload }
  | { row: ProposalRow; action: 'link'; payload: LinkProposalPayload };

/** Stored payloads were checked when they were written, so they are read as they are. */
function typed(row: ProposalRow): TypedProposal {
  switch (row.action) {
    case 'create':
      return { row, action: 'create', payload: row.payload as CreateProposalPayload };
    case 'update':
      return { row, action: 'update', payload: row.payload as UpdateProposalPayload };
    case 'link':
      return { row, action: 'link', payload: row.payload as LinkProposalPayload };
  }
}

/** Order-independent equality of two JSON values (jsonb doesn't keep key order). */
function sameJson(a: unknown, b: unknown): boolean {
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical);
    if (typeof value === 'object' && value !== null) {
      return Object.fromEntries(
        Object.entries(value)
          .filter(([, entry]) => entry !== undefined)
          .sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0))
          .map(([key, entry]) => [key, canonical(entry)]),
      );
    }
    return value;
  };
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}

/**
 * The import's proposals as review cards, with everything a card needs beyond its payload:
 * the names behind the ids, what an update's record holds now, which existing records a new
 * one might duplicate, and what a link would replace. `only` limits the cards returned.
 */
async function proposalViews(
  db: DbOrTx,
  scope: CampaignScope,
  importRow: ImportRow,
  only?: readonly string[],
): Promise<{ proposals: ImportProposal[]; refs: ProposalRefs }> {
  const all = (
    await db
      .select()
      .from(aiProposals)
      .where(proposalsOf(scope, importRow.id))
      .orderBy(asc(aiProposals.position))
  ).map(typed);
  const shown = only === undefined ? all : all.filter(({ row }) => only.includes(row.id));

  // What a single-record link field holds now, for "this replaces …".
  const oneFieldLinks = shown.flatMap((proposal) =>
    proposal.action === 'link' &&
    proposal.payload.fieldKey !== null &&
    linkFieldSpec(proposal.payload.fromType, proposal.payload.fieldKey)?.cardinality === 'one'
      ? [proposal.payload]
      : [],
  );
  const held = new Map<string, string>();
  if (oneFieldLinks.length > 0) {
    const rows = await db
      .select({
        fromId: recordLinks.fromRecordId,
        fieldKey: recordLinks.fieldKey,
        toId: recordLinks.toRecordId,
      })
      .from(recordLinks)
      .where(
        and(
          eq(recordLinks.campaignId, scope.campaignId),
          eq(recordLinks.kind, 'field'),
          inArray(recordLinks.fromRecordId, [...new Set(oneFieldLinks.map((p) => p.fromId))]),
        ),
      );
    for (const row of rows) held.set(`${row.fromId}>${row.fieldKey ?? ''}`, row.toId);
  }
  const heldBy = (payload: LinkProposalPayload): string | null => {
    const toId = held.get(`${payload.fromId}>${payload.fieldKey ?? ''}`);
    return toId === undefined || toId === payload.toId ? null : toId;
  };

  // Every id a shown card points at.
  const ids = new Set<string>();
  for (const proposal of shown) {
    if (proposal.action === 'create') {
      const { payload } = proposal;
      if (payload.parentId !== null) ids.add(payload.parentId);
      for (const list of Object.values(payload.links)) for (const id of list) ids.add(id);
      for (const link of payload.otherLinks) ids.add(link.recordId);
    } else if (proposal.action === 'update') {
      ids.add(proposal.payload.recordId);
    } else {
      ids.add(proposal.payload.fromId);
      ids.add(proposal.payload.toId);
      const replaced = heldBy(proposal.payload);
      if (replaced !== null) ids.add(replaced);
    }
  }

  const refs: ProposalRefs = {};
  // Until the import is saved its new records exist only as proposals.
  if (importRow.status !== 'committed') {
    for (const proposal of all) {
      if (proposal.action !== 'create' || !ids.has(proposal.payload.id)) continue;
      const { id, type, name } = proposal.payload;
      refs[id] = { id, type, name, proposed: true };
    }
  }
  const existingIds = [...ids].filter((id) => refs[id] === undefined);
  const existing =
    existingIds.length === 0
      ? []
      : await db
          .select({
            id: records.id,
            type: records.type,
            name: records.name,
            tags: records.tags,
            revealedAt: records.revealedAt,
            publicDescription: records.publicDescription,
            gmNotes: records.gmNotes,
            fields: records.fields,
          })
          .from(records)
          .where(and(eq(records.campaignId, scope.campaignId), inArray(records.id, existingIds)));
  const before = new Map<string, UpdateBefore>();
  for (const record of existing) {
    refs[record.id] = { id: record.id, type: record.type, name: record.name, proposed: false };
    before.set(record.id, {
      name: record.name,
      tags: record.tags,
      revealedAt: record.revealedAt?.toISOString() ?? null,
      publicDescription: record.publicDescription,
      gmNotes: record.gmNotes,
      fields: record.fields,
    });
  }
  const refOf = (id: string | null): RecordRef | null => {
    const ref = id === null ? undefined : refs[id];
    return ref === undefined ? null : { id: ref.id, type: ref.type, name: ref.name };
  };

  // Duplicates only matter while the GM is still deciding.
  const duplicates =
    importRow.status === 'ready'
      ? await possibleDuplicates(
          db,
          scope,
          shown.flatMap((p) => (p.action === 'create' ? [p.payload] : [])),
        )
      : new Map<string, RecordRef[]>();

  const proposals = shown.map((proposal): ImportProposal => {
    const { row } = proposal;
    const base = { id: row.id, position: row.position, reviewState: row.reviewState };
    const edited = !sameJson(row.payload, row.originalPayload);
    switch (proposal.action) {
      case 'create':
        return {
          ...base,
          action: 'create',
          payload: proposal.payload,
          original: edited ? (row.originalPayload as CreateProposalPayload) : null,
          possibleDuplicates: duplicates.get(proposal.payload.id) ?? [],
        };
      case 'update':
        return {
          ...base,
          action: 'update',
          payload: proposal.payload,
          original: edited ? (row.originalPayload as UpdateProposalPayload) : null,
          before: before.get(proposal.payload.recordId) ?? null,
        };
      case 'link':
        return {
          ...base,
          action: 'link',
          payload: proposal.payload,
          original: edited ? (row.originalPayload as LinkProposalPayload) : null,
          replaces: refOf(heldBy(proposal.payload)),
        };
    }
  });
  return { proposals, refs };
}

/**
 * For each proposed record, the existing records whose name is the same or nearly so
 * (§10 step 5): equal ignoring case, similar as a whole, or one name inside the other
 * ("Voss" and "Captain Voss"). Best matches first, by proposed record id.
 */
async function possibleDuplicates(
  db: DbOrTx,
  scope: CampaignScope,
  creates: readonly CreateProposalPayload[],
): Promise<Map<string, RecordRef[]>> {
  const found = new Map<string, RecordRef[]>();
  if (creates.length === 0) return found;

  // drizzle expands a JS array into a parameter list, so the text[] is built by hand.
  const names = sql.join(
    creates.map((create) => sql`${create.name}`),
    sql`, `,
  );
  const result = await db.execute<{ ord: number; id: string; type: RecordType; name: string }>(sql`
    select n.ord::int as ord, r.id, r.type, r.name
    from unnest(array[${names}]::text[]) with ordinality as n(name, ord)
    join ${records} r
      on r.campaign_id = ${scope.campaignId}
     and (
       lower(r.name) = lower(n.name)
       or similarity(r.name, n.name) >= 0.5
       or word_similarity(n.name, r.name) >= 0.8
       or word_similarity(r.name, n.name) >= 0.8
     )
    order by n.ord, similarity(r.name, n.name) desc, lower(r.name)
  `);
  for (const row of result.rows) {
    const create = creates[row.ord - 1];
    if (create === undefined) continue;
    const list = found.get(create.id) ?? [];
    if (list.length < DUPLICATES_MAX) list.push({ id: row.id, type: row.type, name: row.name });
    found.set(create.id, list);
  }
  return found;
}

// ---------------------------------------------------------------------------
// Reviewing.
// ---------------------------------------------------------------------------

/** Locks the import for a review change. 404 if it isn't this campaign's, 409 unless `ready`. */
async function lockReadyImport(
  tx: DbOrTx,
  scope: CampaignScope,
  importId: string,
): Promise<ImportRow> {
  const [row] = await tx
    .select()
    .from(aiImports)
    .where(scopedImport(scope, importId))
    .for('update');
  if (row === undefined) throw httpError(404, 'Import not found');
  if (row.status === 'ready') return row;
  const why: Record<Exclude<ImportRow['status'], 'ready'>, string> = {
    running: 'This import is still running.',
    questions: "Answer Claude's questions or generate the records first.",
    failed: 'This import failed, so there is nothing to review.',
    committed: 'This import has already been saved.',
    discarded: 'This import was discarded.',
  };
  throw httpError(409, why[row.status]);
}

function firstIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  if (issue === undefined) return 'Invalid proposal';
  return issue.path.length === 0 ? issue.message : `${issue.path.join('.')}: ${issue.message}`;
}

const subset = (ids: readonly string[], of: readonly string[]) =>
  ids.every((id) => of.includes(id));
const LINKS_ONLY_REMOVED = 'Links can be removed during review, not added.';

/**
 * Checks a GM's edit of a proposal against what the model proposed (see
 * `patchProposalRequestSchema` for the rules) and returns the payload to store. 400 on any
 * breach.
 */
async function checkedEdit(
  tx: DbOrTx,
  scope: CampaignScope,
  proposal: ProposalRow,
  candidate: unknown,
): Promise<Record<string, unknown>> {
  if (proposal.action === 'create') {
    const parsed = createProposalPayloadSchema.safeParse(candidate);
    if (!parsed.success) throw httpError(400, firstIssue(parsed.error));
    const next = parsed.data;
    const original = proposal.originalPayload as CreateProposalPayload;
    if (next.id !== original.id || next.type !== original.type) {
      throw httpError(400, "A proposal's record and type can't change.");
    }
    for (const [key, ids] of Object.entries(next.links)) {
      if (!subset(ids, original.links[key] ?? [])) throw httpError(400, LINKS_ONLY_REMOVED);
    }
    const originalOthers = original.otherLinks.map((link) => link.recordId);
    if (
      !subset(
        next.otherLinks.map((link) => link.recordId),
        originalOthers,
      )
    ) {
      throw httpError(400, LINKS_ONLY_REMOVED);
    }
    if (next.parentId !== null && next.parentId !== original.parentId) {
      await requireAreaChoice(tx, scope, proposal.importId, next.parentId);
    }
    return next;
  }

  if (proposal.action === 'update') {
    const parsed = updateProposalPayloadSchema.safeParse(candidate);
    if (!parsed.success) throw httpError(400, firstIssue(parsed.error));
    const next = parsed.data;
    const original = proposal.originalPayload as UpdateProposalPayload;
    if (next.recordId !== original.recordId || next.type !== original.type) {
      throw httpError(400, "A proposal's record and type can't change.");
    }
    const gained =
      (next.name !== undefined && original.name === undefined) ||
      (next.publicDescription !== undefined && original.publicDescription === undefined) ||
      (next.gmNotes !== undefined && original.gmNotes === undefined) ||
      (next.addTags !== undefined && original.addTags === undefined) ||
      !subset(Object.keys(next.fields ?? {}), Object.keys(original.fields ?? {}));
    if (gained) {
      throw httpError(400, 'An update can drop or reword its changes, not gain new ones.');
    }
    return next;
  }

  const parsed = linkProposalPayloadSchema.safeParse(candidate);
  if (!parsed.success) throw httpError(400, firstIssue(parsed.error));
  const next = parsed.data;
  const original = proposal.originalPayload as LinkProposalPayload;
  if (
    next.fromId !== original.fromId ||
    next.fromType !== original.fromType ||
    next.toId !== original.toId ||
    next.fieldKey !== original.fieldKey
  ) {
    throw httpError(400, "Only a link's relationship can be edited.");
  }
  return next;
}

/** 400 unless `areaId` is an Area of this campaign or an Area this import proposes. */
async function requireAreaChoice(
  tx: DbOrTx,
  scope: CampaignScope,
  importId: string,
  areaId: string,
): Promise<void> {
  const types = await recordTypesIn(tx, scope, [areaId]);
  if (types.get(areaId) === 'area') return;
  const creates = await tx
    .select({ payload: aiProposals.payload })
    .from(aiProposals)
    .where(and(proposalsOf(scope, importId), eq(aiProposals.action, 'create')));
  const proposed = creates.some(({ payload }) => {
    const create = payload as CreateProposalPayload;
    return create.id === areaId && create.type === 'area';
  });
  if (!proposed) throw httpError(400, 'Pick an area of this campaign or one this import proposes.');
}

/**
 * Accepts, rejects or edits one proposal. An accepted proposal whose payload differs from
 * the model's is stored as `edited`; an edit alone keeps the GM's verdict.
 */
export async function patchProposal(
  db: Database,
  scope: CampaignScope,
  importId: string,
  proposalId: string,
  patch: PatchProposalRequest,
): Promise<PatchProposalResponse> {
  const importRow = await db.transaction(async (tx) => {
    const row = await lockReadyImport(tx, scope, importId);
    const [proposal] = await tx
      .select()
      .from(aiProposals)
      .where(and(proposalsOf(scope, importId), eq(aiProposals.id, proposalId)));
    if (proposal === undefined) throw httpError(404, 'Proposal not found');

    const payload =
      patch.payload === undefined
        ? proposal.payload
        : await checkedEdit(tx, scope, proposal, patch.payload);
    const verdict = patch.reviewState ?? proposal.reviewState;
    const accepted = verdict === 'accepted' || verdict === 'edited';
    const reviewState: ProposalReviewState = !accepted
      ? verdict
      : sameJson(payload, proposal.originalPayload)
        ? 'accepted'
        : 'edited';

    await tx
      .update(aiProposals)
      .set({ payload, reviewState })
      .where(and(proposalsOf(scope, importId), eq(aiProposals.id, proposalId)));
    return row;
  });

  const { proposals, refs } = await proposalViews(db, scope, importRow, [proposalId]);
  const [proposal] = proposals;
  if (proposal === undefined) throw httpError(404, 'Proposal not found');
  return { proposal, refs };
}

/** Accepts every proposal still pending; rejected ones stay rejected. */
export async function acceptAllProposals(
  db: Database,
  scope: CampaignScope,
  importId: string,
): Promise<ImportDetail> {
  await db.transaction(async (tx) => {
    await lockReadyImport(tx, scope, importId);
    await tx
      .update(aiProposals)
      .set({ reviewState: 'accepted' })
      .where(and(proposalsOf(scope, importId), eq(aiProposals.reviewState, 'pending')));
  });
  return getImport(db, scope, importId);
}

/**
 * Drops an import without saving anything: its proposals stay as history but can no longer
 * be reviewed or saved. Works on an import waiting for answers, `ready` or `failed`;
 * discarding twice is fine.
 */
export async function discardImport(
  db: Database,
  scope: CampaignScope,
  importId: string,
): Promise<ImportSummary> {
  await db.transaction(async (tx) => {
    const [row] = await tx
      .select({ status: aiImports.status })
      .from(aiImports)
      .where(scopedImport(scope, importId))
      .for('update');
    if (row === undefined) throw httpError(404, 'Import not found');
    if (row.status === 'discarded') return;
    if (row.status === 'running') throw httpError(409, 'This import is still running.');
    if (row.status === 'committed') throw httpError(409, 'This import has already been saved.');
    await tx
      .update(aiImports)
      .set({ status: 'discarded', errorCode: null, errorDetails: null })
      .where(scopedImport(scope, importId));
  });
  const row = await requireImport(db, scope, importId);
  return toSummary(row, await proposalCounts(db, scope, [row.id]));
}

// ---------------------------------------------------------------------------
// Commit.
// ---------------------------------------------------------------------------

const isAccepted = (row: ProposalRow) =>
  row.reviewState === 'accepted' || row.reviewState === 'edited';

/**
 * Saves every accepted proposal of a `ready` import in one transaction (§10 step 6): new
 * records first (Areas before the Spots inside them) under the ids their proposals carry,
 * tagged `source = ai_import` with the import's id; then their links; then updates to
 * existing records; then links from existing records. If anything fails, nothing is saved.
 *
 * - An import with no proposals at all is closed with nothing saved; one whose proposals are
 *   all pending or rejected is refused with 409.
 * - Pending and rejected proposals are left out. Links to a record that was left out are
 *   dropped, as are links to a record deleted since the import ran.
 * - A Spot whose Area was left out is refused with 409 naming both, so the GM decides.
 * - An update or link whose own record has been deleted is skipped and reported.
 * - An update changes only the fields it names, and adds tags without removing any.
 */
export async function commitImport(
  db: Database,
  scope: CampaignScope,
  importId: string,
): Promise<CommitImportResponse> {
  const outcome = await db.transaction(async (tx) => {
    const importRow = await lockReadyImport(tx, scope, importId);
    const all = (
      await tx
        .select()
        .from(aiProposals)
        .where(proposalsOf(scope, importId))
        .orderBy(asc(aiProposals.position))
    ).map(typed);
    const accepted = all.filter(({ row }) => isAccepted(row));
    // An import the model proposed nothing for is simply closed.
    if (accepted.length === 0 && all.length > 0) {
      throw httpError(409, 'Accept at least one proposal first.');
    }

    const proposed = new Map<string, { payload: CreateProposalPayload; accepted: boolean }>();
    for (const proposal of all) {
      if (proposal.action !== 'create') continue;
      proposed.set(proposal.payload.id, {
        payload: proposal.payload,
        accepted: isAccepted(proposal.row),
      });
    }
    const creates = accepted.flatMap((p) => (p.action === 'create' ? [p.payload] : []));
    const updates = accepted.flatMap((p) => (p.action === 'update' ? [p] : []));
    const links = accepted.flatMap((p) => (p.action === 'link' ? [p] : []));

    // Every existing record the accepted proposals touch, with its type; ids that are gone
    // are simply absent.
    const touched = new Set<string>();
    for (const create of creates) {
      if (create.parentId !== null) touched.add(create.parentId);
      for (const ids of Object.values(create.links)) for (const id of ids) touched.add(id);
      for (const link of create.otherLinks) touched.add(link.recordId);
    }
    for (const { payload } of updates) touched.add(payload.recordId);
    for (const { payload } of links) {
      touched.add(payload.fromId);
      touched.add(payload.toId);
    }
    const existing = await recordTypesIn(
      tx,
      scope,
      [...touched].filter((id) => !proposed.has(id)),
    );
    /** True for a record that will exist once this commit is done. */
    const known = (id: string) => proposed.get(id)?.accepted === true || existing.has(id);

    for (const create of creates) {
      if (create.type !== 'spot' || create.parentId === null) continue;
      const area = proposed.get(create.parentId);
      if (area !== undefined && !area.accepted) {
        throw httpError(
          409,
          `"${create.name}" is a spot in "${area.payload.name}", which isn't accepted. Accept that area, pick another area for the spot, or reject the spot.`,
        );
      }
      if (area === undefined && existing.get(create.parentId) !== 'area') {
        throw httpError(
          409,
          `The area of "${create.name}" no longer exists. Pick another area for the spot, or reject it.`,
        );
      }
    }

    // 1. The new records, Areas first so their Spots find them.
    const rank = (type: RecordType) => (type === 'area' ? 0 : type === 'spot' ? 2 : 1);
    const ordered = [...creates].sort((a, b) => rank(a.type) - rank(b.type));
    const created = new Map<string, Awaited<ReturnType<typeof insertRecordRow>>>();
    for (const create of ordered) {
      const request = createRecordRequestSchema.parse({
        type: create.type,
        name: create.name,
        publicDescription: create.publicDescription,
        gmNotes: create.gmNotes,
        tags: create.tags,
        fields: create.fields,
        ...(create.type === 'spot' ? { parentId: create.parentId } : {}),
      });
      const row = await insertRecordRow(tx, scope, request, {
        id: create.id,
        source: 'ai_import',
        aiImportId: importRow.id,
      });
      created.set(create.id, row);
    }

    // 2. Their links, now that every new record exists.
    for (const create of ordered) {
      const row = created.get(create.id);
      if (row === undefined) continue;
      await linkNewRecord(tx, scope, row, {
        links: Object.fromEntries(
          Object.entries(create.links).map(([key, ids]) => [key, ids.filter(known)]),
        ),
        otherLinks: create.otherLinks.filter((link) => known(link.recordId)),
      });
    }

    const skipped: CommitImportResponse['skipped'] = [];

    // 3. Updates to existing records.
    const updated: RecordRef[] = [];
    for (const { row, payload } of updates) {
      if (!existing.has(payload.recordId)) {
        skipped.push({ proposalId: row.id, reason: 'The record has been deleted.' });
        continue;
      }
      const patch: UpdateRecordRequest = {};
      if (payload.name !== undefined) patch.name = payload.name;
      if (payload.publicDescription !== undefined) {
        patch.publicDescription = payload.publicDescription;
      }
      if (payload.gmNotes !== undefined) patch.gmNotes = payload.gmNotes;
      if (payload.fields !== undefined) patch.fields = payload.fields;
      if (payload.addTags !== undefined && payload.addTags.length > 0) {
        const [current] = await tx
          .select({ tags: records.tags })
          .from(records)
          .where(and(eq(records.id, payload.recordId), eq(records.campaignId, scope.campaignId)))
          .for('no key update');
        const tags = [...new Set([...(current?.tags ?? []), ...payload.addTags])];
        patch.tags = tags.slice(0, TAGS_MAX);
      }
      if (Object.keys(patch).length === 0) continue;
      const record = await updateRecordRow(tx, scope, payload.recordId, patch);
      updated.push({ id: record.id, type: record.type, name: record.name });
    }

    // 4. Links from existing records.
    let linksAdded = 0;
    const touchedSources = new Set<string>();
    for (const { row, payload } of links) {
      const fromType = existing.get(payload.fromId);
      if (fromType === undefined || !known(payload.toId)) {
        skipped.push({
          proposalId: row.id,
          reason:
            fromType === undefined
              ? 'The record has been deleted.'
              : 'The record it links to was left out or deleted.',
        });
        continue;
      }
      const added =
        payload.fieldKey === null
          ? Number(
              await addOtherLink(tx, scope, payload.fromId, {
                recordId: payload.toId,
                label: payload.label,
              }),
            )
          : await addFieldLinks(
              tx,
              scope,
              { id: payload.fromId, type: fromType },
              payload.fieldKey,
              [payload.toId],
            );
      if (added > 0) touchedSources.add(payload.fromId);
      linksAdded += added;
    }
    // A change to links alone still counts as an edit of the record.
    if (touchedSources.size > 0) {
      await tx
        .update(records)
        .set({ updatedAt: new Date() })
        .where(
          and(eq(records.campaignId, scope.campaignId), inArray(records.id, [...touchedSources])),
        );
    }

    await tx
      .update(aiImports)
      .set({ status: 'committed', committedAt: new Date() })
      .where(scopedImport(scope, importId));

    return {
      created: ordered.map(({ id, type, name }) => ({ id, type, name })),
      updated,
      linksAdded,
      skipped,
    };
  });

  const row = await requireImport(db, scope, importId);
  return { import: toSummary(row, await proposalCounts(db, scope, [row.id])), ...outcome };
}

// ---------------------------------------------------------------------------
// Usage (user-scoped: a GM's imports across their campaigns).
// ---------------------------------------------------------------------------

/** The GM's own imports with their token usage and estimated cost (§10 cost guardrails). */
export async function listUsage(db: Database, userId: string): Promise<UsageResponse> {
  const rows = await db
    .select({
      id: aiImports.id,
      campaignId: aiImports.campaignId,
      campaignName: campaigns.name,
      mode: aiImports.mode,
      status: aiImports.status,
      model: aiImports.model,
      inputTokens: aiImports.inputTokens,
      outputTokens: aiImports.outputTokens,
      cacheReadTokens: aiImports.cacheReadTokens,
      cacheWriteTokens: aiImports.cacheWriteTokens,
      createdAt: aiImports.createdAt,
    })
    .from(aiImports)
    .innerJoin(campaigns, eq(campaigns.id, aiImports.campaignId))
    .where(eq(aiImports.userId, userId))
    .orderBy(desc(aiImports.createdAt), desc(aiImports.id))
    .limit(AI_IMPORT_LIMITS.listMax);

  const sum = (column: AnyPgColumn) => sql<number>`coalesce(sum(${column}), 0)::int`;
  const perModel = await db
    .select({
      model: aiImports.model,
      imports: count(),
      inputTokens: sum(aiImports.inputTokens),
      outputTokens: sum(aiImports.outputTokens),
      cacheReadTokens: sum(aiImports.cacheReadTokens),
      cacheWriteTokens: sum(aiImports.cacheWriteTokens),
    })
    .from(aiImports)
    .where(eq(aiImports.userId, userId))
    .groupBy(aiImports.model);

  const totals: UsageResponse['totals'] = {
    imports: 0,
    usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
    estimatedCostUsd: 0,
  };
  for (const group of perModel) {
    const usage = usageOf(group);
    totals.imports += group.imports;
    totals.usage.inputTokens += usage.inputTokens;
    totals.usage.outputTokens += usage.outputTokens;
    totals.usage.cacheReadTokens += usage.cacheReadTokens;
    totals.usage.cacheWriteTokens += usage.cacheWriteTokens;
    totals.estimatedCostUsd += estimateCostUsd(group.model, usage) ?? 0;
  }

  return {
    imports: rows.map((row) => {
      const usage = usageOf(row);
      return {
        id: row.id,
        campaignId: row.campaignId,
        campaignName: row.campaignName,
        mode: row.mode,
        status: row.status,
        model: row.model,
        usage,
        estimatedCostUsd: estimateCostUsd(row.model, usage),
        createdAt: row.createdAt.toISOString(),
      };
    }),
    totals,
  };
}
