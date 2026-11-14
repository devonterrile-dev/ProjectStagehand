/**
 * Visual assets (F2.3, governance §11, D-42): the only code that queries `assets`, and the
 * only code that sets a record's or PC's `visual_asset_id`.
 *
 * Routes start a try (`startVisual`, a `generating` row), the queue's worker makes the image
 * (`claimVisual` → `finishVisual`, with its post-processed version), and the GM reviews it
 * (F2.5, D-44): a record or PC has one image in use and at most a draft and a change of it
 * (`revised_from_id`). The GM uses a draft (`useVisual`, which discards the image it replaces)
 * or discards it (`discardVisual`). A discarded try keeps its row as `rejected`, for the hourly
 * limit and its cost, but its files are deleted; `purgeDiscarded` finishes any deletion a
 * crash cut short. Images made before post-processing existed, or by an older version of it,
 * are processed again at startup (`assetsToProcess` → `saveProcessed`).
 *
 * Every function that takes a scope stays inside its campaign; the worker's functions take
 * only an asset id, which it got from a row we inserted.
 */
import {
  assetSummarySchema,
  isVisualSubject,
  VISUAL_LIMITS,
  visualsResponseSchema,
  type AssetImageVariant,
  type AssetKind,
  type AssetSummary,
  type ImageAspectRatio,
  type ImageQuality,
  type StageImage,
  type VisualErrorCode,
  type VisualsResponse,
} from '@stagehand/shared';
import {
  and,
  count,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  lt,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';

import type { Database } from '../db/client';
import { assets, characters, records } from '../db/schema';
import { httpError } from '../http/errors';
import { PROCESSED_MEDIA_TYPE } from '../visuals/process';
import type { VisualSource } from '../visuals/prompt';
import type { AssetStorage } from '../visuals/storage';

import type { DbOrTx } from './members';
import type { CampaignScope } from './scope';

type AssetRow = typeof assets.$inferSelect;

/** Tries not in use and not discarded: what the GM still has to review. */
const DRAFT_STATUSES = ['generating', 'pending', 'failed'] as const;
/** Tries with an image the GM may see. */
const SHOWN_STATUSES = ['pending', 'approved'] as const;

/** Whose visual: a record's or a PC's. */
export type VisualOwner = { recordId: string } | { characterId: string };

const RECORD_NOT_FOUND = 'Record not found';
const CHARACTER_NOT_FOUND = 'Character not found';
const ASSET_NOT_FOUND = 'Image not found';

function toSummary(row: AssetRow): AssetSummary {
  return assetSummarySchema.parse({
    id: row.id,
    kind: row.kind,
    status: row.status,
    errorCode: row.errorCode,
    costUsd: row.costUsd,
    processed:
      row.processedPath === null ||
      row.processedWidth === null ||
      row.processedHeight === null ||
      row.processingVersion === null
        ? null
        : {
            width: row.processedWidth,
            height: row.processedHeight,
            version: row.processingVersion,
          },
    revisedFromId: row.revisedFromId,
    revisionNotes: row.revisionNotes,
    createdAt: row.createdAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
  });
}

/** `assets.record_id = …` or `assets.character_id = …`. */
function ownedBy(owner: VisualOwner): SQL {
  return 'recordId' in owner
    ? eq(assets.recordId, owner.recordId)
    : eq(assets.characterId, owner.characterId);
}

/** A `generating` try older than any job can run was lost: it is failed, `interrupted`. */
async function expireLost(db: Database, where: SQL | undefined): Promise<void> {
  await db
    .update(assets)
    .set({ status: 'failed', errorCode: 'interrupted', finishedAt: new Date() })
    .where(
      and(
        where,
        eq(assets.status, 'generating'),
        lt(assets.createdAt, new Date(Date.now() - VISUAL_LIMITS.generatingMaxMs)),
      ),
    );
}

/**
 * What a prompt is made from, and the visual in use. 404 if the record or PC isn't in this
 * campaign; 400 for a record type that has no visual (Area, Faction, Lore, …).
 */
export async function loadVisualSource(
  db: Database,
  scope: CampaignScope,
  owner: VisualOwner,
): Promise<{ source: VisualSource; visualAssetId: string | null }> {
  if ('characterId' in owner) {
    const [row] = await db
      .select()
      .from(characters)
      .where(
        and(eq(characters.id, owner.characterId), eq(characters.campaignId, scope.campaignId)),
      );
    if (row === undefined) throw httpError(404, CHARACTER_NOT_FOUND);
    return {
      source: {
        subject: 'pc',
        name: row.name,
        publicDescription: row.publicDescription,
        className: row.className,
      },
      visualAssetId: row.visualAssetId,
    };
  }

  const [row] = await db
    .select()
    .from(records)
    .where(and(eq(records.id, owner.recordId), eq(records.campaignId, scope.campaignId)));
  if (row === undefined) throw httpError(404, RECORD_NOT_FOUND);
  const type = row.type;
  if (!isVisualSubject(type)) {
    throw httpError(400, 'Only NPCs, Props, Items and Spots have a visual');
  }

  let area: { name: string; publicDescription: VisualSource['publicDescription'] } | null = null;
  if (type === 'spot' && row.parentId !== null) {
    const [parent] = await db
      .select({ name: records.name, publicDescription: records.publicDescription })
      .from(records)
      .where(and(eq(records.id, row.parentId), eq(records.campaignId, scope.campaignId)));
    area = parent ?? null;
  }
  return {
    source: {
      subject: type,
      name: row.name,
      publicDescription: row.publicDescription,
      fields: row.fields,
      area,
    },
    visualAssetId: row.visualAssetId,
  };
}

export interface StartVisualInput {
  kind: AssetKind;
  prompt: string;
  model: string;
  styleBibleVersion: number;
  quality: ImageQuality;
  aspectRatio: ImageAspectRatio;
  /** Regenerate with notes (F2.5): the asset whose original is changed, and the GM's notes. */
  revision?: { fromId: string; notes: string };
}

/** Holds the GM's lock until the transaction ends: their image actions run one at a time. */
async function lockGm(tx: DbOrTx, userId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${userId}, 0))`);
}

/** The owner's image in use, read inside a transaction. 404 if the owner isn't in this campaign. */
async function visualAssetIdIn(
  tx: DbOrTx,
  scope: CampaignScope,
  owner: VisualOwner,
): Promise<string | null> {
  if ('recordId' in owner) {
    const [row] = await tx
      .select({ visualAssetId: records.visualAssetId })
      .from(records)
      .where(and(eq(records.id, owner.recordId), eq(records.campaignId, scope.campaignId)));
    if (row === undefined) throw httpError(404, RECORD_NOT_FOUND);
    return row.visualAssetId;
  }
  const [row] = await tx
    .select({ visualAssetId: characters.visualAssetId })
    .from(characters)
    .where(and(eq(characters.id, owner.characterId), eq(characters.campaignId, scope.campaignId)));
  if (row === undefined) throw httpError(404, CHARACTER_NOT_FOUND);
  return row.visualAssetId;
}

/** The owner's drafts, oldest first. */
async function draftsOf(tx: DbOrTx, scope: CampaignScope, owner: VisualOwner): Promise<AssetRow[]> {
  return tx
    .select()
    .from(assets)
    .where(
      and(
        ownedBy(owner),
        eq(assets.campaignId, scope.campaignId),
        inArray(assets.status, [...DRAFT_STATUSES]),
      ),
    )
    .orderBy(assets.createdAt, assets.id);
}

const WAIT_FOR_IMAGE = 'An image for this is already being made. Wait for it to finish.';
const REVIEW_FIRST = 'Use or discard the new image first.';
const COMPARE_FIRST = 'Keep the new version or go back to the old one first.';

/** Discards rows (status only; their files go in `removeFiles`, after the transaction). */
async function markRejected(tx: DbOrTx, ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  await tx
    .update(assets)
    .set({ status: 'rejected', errorCode: null })
    .where(inArray(assets.id, [...ids]));
}

/** The files of discarded rows, still to be deleted. */
interface DiscardedFiles {
  id: string;
  originalPath: string | null;
  processedPath: string | null;
}

async function discardedFiles(db: DbOrTx, ids: readonly string[]): Promise<DiscardedFiles[]> {
  if (ids.length === 0) return [];
  return db
    .select({
      id: assets.id,
      originalPath: assets.originalPath,
      processedPath: assets.processedPath,
    })
    .from(assets)
    .where(and(inArray(assets.id, [...ids]), eq(assets.status, 'rejected')));
}

/**
 * Deletes discarded rows' files, then forgets their paths. A file that can't be deleted keeps
 * its path, so the next startup's `purgeDiscarded` tries again; nothing is thrown, since the
 * GM's action itself has already happened.
 */
async function removeFiles(
  db: Database,
  storage: AssetStorage,
  rows: readonly DiscardedFiles[],
): Promise<number> {
  let removed = 0;
  for (const row of rows) {
    try {
      for (const key of [row.originalPath, row.processedPath]) {
        if (key !== null) await storage.remove(key);
      }
      await db
        .update(assets)
        .set({
          originalPath: null,
          processedPath: null,
          processedWidth: null,
          processedHeight: null,
          processingVersion: null,
        })
        .where(and(eq(assets.id, row.id), eq(assets.status, 'rejected')));
      removed += 1;
    } catch {
      // Left for the next startup.
    }
  }
  return removed;
}

/**
 * Records a new try as `generating`, for the queue to pick up (F2.3; review rules F2.5, D-44).
 *
 * Refused (409) while this record or PC has a try being made or the GM has `generatingAtOnce`
 * of them, and (429) after `jobsPerHour` in the last hour. A fresh try is refused while a
 * finished draft waits for review. A change (`revision`) may start from the one draft, or from
 * the image in use when there is no draft. Earlier failed tries are dismissed. The checks and
 * the insert run under a per-GM lock, so two quick clicks can't both get through. Callers check
 * `assertGm`, `assertWritable` and the key.
 */
export async function startVisual(
  db: Database,
  scope: CampaignScope,
  owner: VisualOwner,
  input: StartVisualInput,
): Promise<AssetSummary> {
  await expireLost(db, eq(assets.createdBy, scope.userId));

  return db.transaction(async (tx) => {
    await lockGm(tx, scope.userId);
    const visualAssetId = await visualAssetIdIn(tx, scope, owner);
    const drafts = await draftsOf(tx, scope, owner);
    if (drafts.some((draft) => draft.status === 'generating')) throw httpError(409, WAIT_FOR_IMAGE);

    const pending = drafts.filter((draft) => draft.status === 'pending');
    if (input.revision === undefined) {
      if (pending.length > 0) throw httpError(409, REVIEW_FIRST);
    } else {
      const fromId = input.revision.fromId;
      const fromDraft = pending.length === 1 && pending[0]?.id === fromId;
      const fromInUse = pending.length === 0 && fromId === visualAssetId;
      if (!fromDraft && !fromInUse) {
        throw httpError(409, pending.length > 1 ? COMPARE_FIRST : REVIEW_FIRST);
      }
    }

    const [running] = await tx
      .select({ n: count() })
      .from(assets)
      .where(and(eq(assets.createdBy, scope.userId), eq(assets.status, 'generating')));
    if ((running?.n ?? 0) >= VISUAL_LIMITS.generatingAtOnce) {
      throw httpError(
        409,
        `You have ${String(VISUAL_LIMITS.generatingAtOnce)} images being made. Wait for one to finish.`,
      );
    }

    const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const [recent] = await tx
      .select({ n: count() })
      .from(assets)
      .where(and(eq(assets.createdBy, scope.userId), gt(assets.createdAt, hourAgo)));
    if ((recent?.n ?? 0) >= VISUAL_LIMITS.jobsPerHour) {
      throw httpError(
        429,
        `You've started ${String(VISUAL_LIMITS.jobsPerHour)} images in the last hour. Try again later.`,
      );
    }

    // A failed try has no files; starting another dismisses it.
    await markRejected(
      tx,
      drafts.filter((draft) => draft.status === 'failed').map((draft) => draft.id),
    );

    const [row] = await tx
      .insert(assets)
      .values({
        campaignId: scope.campaignId,
        ...('recordId' in owner
          ? { recordId: owner.recordId }
          : { characterId: owner.characterId }),
        createdBy: scope.userId,
        kind: input.kind,
        prompt: input.prompt,
        model: input.model,
        styleBibleVersion: input.styleBibleVersion,
        quality: input.quality,
        aspectRatio: input.aspectRatio,
        revisedFromId: input.revision?.fromId ?? null,
        revisionNotes: input.revision?.notes ?? null,
      })
      .returning();
    if (row === undefined) throw new Error('asset insert returned no row');
    return toSummary(row);
  });
}

/**
 * The image a Regenerate with notes would change: one of this owner's finished images (a draft
 * or the one in use). 404 otherwise. Whether it may be changed right now is `startVisual`'s
 * call, under the lock.
 */
export async function revisionBaseOf(
  db: Database,
  scope: CampaignScope,
  owner: VisualOwner,
  assetId: string,
): Promise<{ kind: AssetKind }> {
  const [row] = await db
    .select({ kind: assets.kind })
    .from(assets)
    .where(
      and(
        eq(assets.id, assetId),
        eq(assets.campaignId, scope.campaignId),
        ownedBy(owner),
        inArray(assets.status, [...SHOWN_STATUSES]),
        isNotNull(assets.originalPath),
      ),
    );
  if (row === undefined) throw httpError(404, ASSET_NOT_FOUND);
  return row;
}

/** The image in use and the drafts under review (F2.5, D-44). */
export async function listVisuals(
  db: Database,
  scope: CampaignScope,
  owner: VisualOwner,
): Promise<VisualsResponse> {
  const { visualAssetId } = await loadVisualSource(db, scope, owner);
  await expireLost(db, and(ownedBy(owner), eq(assets.campaignId, scope.campaignId)));
  const [inUse] =
    visualAssetId === null
      ? []
      : await db
          .select()
          .from(assets)
          .where(and(eq(assets.id, visualAssetId), eq(assets.campaignId, scope.campaignId)));
  const drafts = await draftsOf(db, scope, owner);
  return visualsResponseSchema.parse({
    visualAssetId,
    inUse: inUse === undefined ? null : toSummary(inUse),
    drafts: drafts.map(toSummary),
  });
}

/**
 * "Use this" / "Replace" (F2.5, D-44): makes one of the record's or PC's finished drafts its
 * visual and marks it approved. The image it replaces and any failed try are discarded, files
 * and all. Refused while an image is being made, or while a change waits for Keep new / Go
 * back. Callers check `assertGm` and `assertWritable`.
 */
export async function useVisual(
  db: Database,
  storage: AssetStorage,
  scope: CampaignScope,
  owner: VisualOwner,
  assetId: string,
): Promise<VisualsResponse> {
  const discarded = await db.transaction(async (tx) => {
    await lockGm(tx, scope.userId);
    const visualAssetId = await visualAssetIdIn(tx, scope, owner);
    const [asset] = await tx
      .select({ id: assets.id, status: assets.status })
      .from(assets)
      .where(and(eq(assets.id, assetId), eq(assets.campaignId, scope.campaignId), ownedBy(owner)));
    if (asset === undefined || asset.status === 'rejected') throw httpError(404, ASSET_NOT_FOUND);
    if (asset.id === visualAssetId) return [];

    const drafts = await draftsOf(tx, scope, owner);
    if (drafts.some((draft) => draft.status === 'generating')) throw httpError(409, WAIT_FOR_IMAGE);
    if (asset.status !== 'pending') throw httpError(409, 'Only a finished image can be used');
    if (drafts.filter((draft) => draft.status === 'pending').length > 1) {
      throw httpError(409, COMPARE_FIRST);
    }

    await tx.update(assets).set({ status: 'approved' }).where(eq(assets.id, assetId));
    if ('recordId' in owner) {
      await tx
        .update(records)
        .set({ visualAssetId: assetId })
        .where(and(eq(records.id, owner.recordId), eq(records.campaignId, scope.campaignId)));
    } else {
      await tx
        .update(characters)
        .set({ visualAssetId: assetId })
        .where(
          and(eq(characters.id, owner.characterId), eq(characters.campaignId, scope.campaignId)),
        );
    }
    const replaced = [
      ...(visualAssetId === null ? [] : [visualAssetId]),
      ...drafts.filter((draft) => draft.status === 'failed').map((draft) => draft.id),
    ];
    await markRejected(tx, replaced);
    return discardedFiles(tx, replaced);
  });
  await removeFiles(db, storage, discarded);
  return listVisuals(db, scope, owner);
}

/**
 * "Discard", "Keep current", "Keep new" (discards the old version), "Go back" (discards the
 * new one) and dismissing a failed try (F2.5, D-44): the draft becomes `rejected` and its files
 * are deleted. The image in use can only be replaced, never discarded here. Refused while an
 * image is being made: it may be a change of this very draft. Discarding a try already
 * discarded changes nothing. Callers check `assertGm` and `assertWritable`.
 */
export async function discardVisual(
  db: Database,
  storage: AssetStorage,
  scope: CampaignScope,
  owner: VisualOwner,
  assetId: string,
): Promise<VisualsResponse> {
  const discarded = await db.transaction(async (tx) => {
    await lockGm(tx, scope.userId);
    const visualAssetId = await visualAssetIdIn(tx, scope, owner);
    const [asset] = await tx
      .select({ id: assets.id, status: assets.status })
      .from(assets)
      .where(and(eq(assets.id, assetId), eq(assets.campaignId, scope.campaignId), ownedBy(owner)));
    if (asset === undefined) throw httpError(404, ASSET_NOT_FOUND);
    if (asset.status === 'rejected') return [];
    if (asset.id === visualAssetId || asset.status === 'approved') {
      throw httpError(409, 'This is the image in use. Replace it with a new one instead.');
    }
    const drafts = await draftsOf(tx, scope, owner);
    if (drafts.some((draft) => draft.status === 'generating')) throw httpError(409, WAIT_FOR_IMAGE);

    await markRejected(tx, [asset.id]);
    return discardedFiles(tx, [asset.id]);
  });
  await removeFiles(db, storage, discarded);
  return listVisuals(db, scope, owner);
}

/**
 * At startup: drafts whose record or PC was deleted are discarded, and every discarded try
 * that still has files (the migration's tidy, or a deletion a crash cut short) loses them.
 * Returns how many tries had files deleted.
 */
export async function purgeDiscarded(db: Database, storage: AssetStorage): Promise<number> {
  await db
    .update(assets)
    .set({ status: 'rejected', errorCode: null })
    .where(
      and(
        inArray(assets.status, ['pending', 'failed']),
        isNull(assets.recordId),
        isNull(assets.characterId),
      ),
    );
  const rows = await db
    .select({
      id: assets.id,
      originalPath: assets.originalPath,
      processedPath: assets.processedPath,
    })
    .from(assets)
    .where(
      and(
        eq(assets.status, 'rejected'),
        or(isNotNull(assets.originalPath), isNotNull(assets.processedPath)),
      ),
    );
  return removeFiles(db, storage, rows);
}

/**
 * Where an asset's image is stored: the processed one unless the original is asked for, or
 * the original while nothing has been processed. 404 for another campaign's asset, one with
 * no image yet, or one discarded.
 */
export async function assetImageOf(
  db: Database,
  scope: CampaignScope,
  assetId: string,
  variant: AssetImageVariant = 'processed',
): Promise<{ key: string; mediaType: string }> {
  const [row] = await db
    .select({
      original: assets.originalPath,
      mediaType: assets.mediaType,
      processed: assets.processedPath,
    })
    .from(assets)
    .where(
      and(
        eq(assets.id, assetId),
        eq(assets.campaignId, scope.campaignId),
        inArray(assets.status, [...SHOWN_STATUSES]),
      ),
    );
  if (row?.original === null || row?.original === undefined) {
    throw httpError(404, ASSET_NOT_FOUND);
  }
  if (variant === 'processed' && row.processed !== null) {
    return { key: row.processed, mediaType: PROCESSED_MEDIA_TYPE };
  }
  return { key: row.original, mediaType: row.mediaType ?? 'image/png' };
}

/**
 * The stage's version of each image in use among `assetIds` (F3.2): its size and the version
 * that goes in its URL. An id is left out when it isn't an approved asset of this campaign, or
 * has no stage version yet (post-processing failed or hasn't run).
 */
export async function stageImagesOf(
  db: DbOrTx,
  scope: CampaignScope,
  assetIds: readonly string[],
): Promise<Map<string, StageImage>> {
  const ids = [...new Set(assetIds)];
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({
      id: assets.id,
      width: assets.processedWidth,
      height: assets.processedHeight,
      version: assets.processingVersion,
    })
    .from(assets)
    .where(
      and(
        eq(assets.campaignId, scope.campaignId),
        inArray(assets.id, ids),
        eq(assets.status, 'approved'),
        isNotNull(assets.processedPath),
      ),
    );
  const images = new Map<string, StageImage>();
  for (const row of rows) {
    if (row.width === null || row.height === null || row.version === null) continue;
    images.set(row.id, {
      assetId: row.id,
      width: row.width,
      height: row.height,
      version: row.version,
    });
  }
  return images;
}

// --- The worker's side ------------------------------------------------------------------

/** What the worker needs to make one image. */
export interface ClaimedVisual {
  id: string;
  campaignId: string;
  createdBy: string;
  kind: AssetKind;
  prompt: string;
  model: string;
  quality: ImageQuality;
  aspectRatio: ImageAspectRatio;
  /**
   * For a Regenerate with notes (F2.5): the stored original of the image being changed, sent as
   * the only reference. `originalPath` is null if that image has lost its file.
   */
  revisionOf: { originalPath: string | null; mediaType: string | null } | null;
}

/**
 * Marks a queued try as started and returns it, or null if it isn't waiting any more (already
 * started, finished, or gone). So a job delivered twice makes one image.
 */
export async function claimVisual(db: Database, assetId: string): Promise<ClaimedVisual | null> {
  const [row] = await db
    .update(assets)
    .set({ startedAt: new Date() })
    .where(
      and(
        eq(assets.id, assetId),
        eq(assets.status, 'generating'),
        sql`${assets.startedAt} is null`,
      ),
    )
    .returning({
      id: assets.id,
      campaignId: assets.campaignId,
      createdBy: assets.createdBy,
      kind: assets.kind,
      prompt: assets.prompt,
      model: assets.model,
      quality: assets.quality,
      aspectRatio: assets.aspectRatio,
      revisedFromId: assets.revisedFromId,
    });
  if (row === undefined) return null;
  const { revisedFromId, ...claimed } = row;
  if (revisedFromId === null) return { ...claimed, revisionOf: null };
  const [base] = await db
    .select({ originalPath: assets.originalPath, mediaType: assets.mediaType })
    .from(assets)
    .where(eq(assets.id, revisedFromId));
  return { ...claimed, revisionOf: base ?? { originalPath: null, mediaType: null } };
}

/** A stored post-processed image (F2.4). */
export interface ProcessedFile {
  key: string;
  width: number;
  height: number;
  version: number;
}

export type VisualOutcome =
  | {
      ok: true;
      key: string;
      mediaType: string;
      costUsd: number | null;
      /** Null when post-processing failed: the try still counts, with its original only. */
      processed: ProcessedFile | null;
    }
  | { ok: false; errorCode: VisualErrorCode };

function processedColumns(processed: ProcessedFile) {
  return {
    processedPath: processed.key,
    processedWidth: processed.width,
    processedHeight: processed.height,
    processingVersion: processed.version,
  };
}

/** Stores how a started try ended. Only a try still `generating` is changed. */
export async function finishVisual(
  db: Database,
  assetId: string,
  outcome: VisualOutcome,
): Promise<void> {
  await db
    .update(assets)
    .set(
      outcome.ok
        ? {
            status: 'pending',
            originalPath: outcome.key,
            mediaType: outcome.mediaType,
            costUsd: outcome.costUsd,
            ...(outcome.processed === null ? {} : processedColumns(outcome.processed)),
            finishedAt: new Date(),
          }
        : { status: 'failed', errorCode: outcome.errorCode, finishedAt: new Date() },
    )
    .where(and(eq(assets.id, assetId), eq(assets.status, 'generating')));
}

/**
 * At startup: a try that had started but never finished was cut off by the last shutdown, so
 * it is failed, `interrupted`. Tries not yet started are still in the queue and will run.
 */
export async function failInterruptedVisuals(db: Database): Promise<number> {
  const rows = await db
    .update(assets)
    .set({ status: 'failed', errorCode: 'interrupted', finishedAt: new Date() })
    .where(and(eq(assets.status, 'generating'), isNotNull(assets.startedAt)))
    .returning({ id: assets.id });
  return rows.length;
}

/** An image whose stage version is missing or was made by an older post-processing version. */
export interface UnprocessedVisual {
  id: string;
  campaignId: string;
  kind: AssetKind;
  originalPath: string;
}

/** Every finished image that still needs (re)processing; at startup they are queued. */
export async function assetsToProcess(db: Database, version: number): Promise<UnprocessedVisual[]> {
  const rows = await db
    .select({
      id: assets.id,
      campaignId: assets.campaignId,
      kind: assets.kind,
      originalPath: assets.originalPath,
    })
    .from(assets)
    .where(
      and(
        inArray(assets.status, [...SHOWN_STATUSES]),
        isNotNull(assets.originalPath),
        or(isNull(assets.processingVersion), lt(assets.processingVersion, version)),
      ),
    )
    .orderBy(desc(assets.createdAt));
  return rows.flatMap((row) =>
    row.originalPath === null ? [] : [{ ...row, originalPath: row.originalPath }],
  );
}

/** One image to (re)process, or null if it has no original (yet) or is already at `version`. */
export async function unprocessedVisual(
  db: Database,
  assetId: string,
  version: number,
): Promise<UnprocessedVisual | null> {
  const [row] = await db
    .select({
      id: assets.id,
      campaignId: assets.campaignId,
      kind: assets.kind,
      originalPath: assets.originalPath,
    })
    .from(assets)
    .where(
      and(
        eq(assets.id, assetId),
        inArray(assets.status, [...SHOWN_STATUSES]),
        or(isNull(assets.processingVersion), lt(assets.processingVersion, version)),
      ),
    );
  if (row?.originalPath === null || row?.originalPath === undefined) return null;
  return { ...row, originalPath: row.originalPath };
}

/**
 * Stores a (re)processed image. A newer version already stored is never replaced by an older
 * (`stale`), and a try discarded meanwhile gets nothing (`discarded`: the caller deletes the
 * file it wrote, which no row points at now).
 */
export async function saveProcessed(
  db: Database,
  assetId: string,
  processed: ProcessedFile,
): Promise<'saved' | 'stale' | 'discarded'> {
  const rows = await db
    .update(assets)
    .set(processedColumns(processed))
    .where(
      and(
        eq(assets.id, assetId),
        inArray(assets.status, [...SHOWN_STATUSES]),
        or(isNull(assets.processingVersion), lt(assets.processingVersion, processed.version)),
      ),
    )
    .returning({ id: assets.id });
  if (rows.length > 0) return 'saved';
  const [row] = await db
    .select({ status: assets.status })
    .from(assets)
    .where(eq(assets.id, assetId));
  return row === undefined || row.status === 'rejected' ? 'discarded' : 'stale';
}
