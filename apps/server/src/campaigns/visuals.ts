/**
 * Visual assets (F2.3, governance §11, D-42): the only code that queries `assets`, and the
 * only code that sets a record's or PC's `visual_asset_id`.
 *
 * Routes start a try (`startVisual`, a `generating` row), the queue's worker makes the image
 * (`claimVisual` → `finishVisual`, with its post-processed version), and the GM lists the
 * tries and picks one (`useVisual`). Images made before post-processing existed, or by an
 * older version of it, are processed again at startup (`assetsToProcess` → `saveProcessed`).
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

import type { CampaignScope } from './scope';

type AssetRow = typeof assets.$inferSelect;

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
}

/**
 * Records a new try as `generating`, for the queue to pick up. Refused (409) while this record
 * or PC already has one in flight or the GM has `generatingAtOnce` of them, and (429) after
 * `jobsPerHour` in the last hour. The checks and the insert run under a per-GM lock, so two
 * quick clicks can't both get through. Callers check `assertGm`, `assertWritable` and the key.
 */
export async function startVisual(
  db: Database,
  scope: CampaignScope,
  owner: VisualOwner,
  input: StartVisualInput,
): Promise<AssetSummary> {
  await expireLost(db, eq(assets.createdBy, scope.userId));

  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${scope.userId}, 0))`);

    const [mine] = await tx
      .select({ n: count() })
      .from(assets)
      .where(and(ownedBy(owner), eq(assets.status, 'generating')));
    if ((mine?.n ?? 0) > 0) {
      throw httpError(409, 'An image for this is already being made. Wait for it to finish.');
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
      })
      .returning();
    if (row === undefined) throw new Error('asset insert returned no row');
    return toSummary(row);
  });
}

/** The latest tries for a record or PC, newest first, and the one in use. */
export async function listVisuals(
  db: Database,
  scope: CampaignScope,
  owner: VisualOwner,
): Promise<VisualsResponse> {
  const { visualAssetId } = await loadVisualSource(db, scope, owner);
  await expireLost(db, and(ownedBy(owner), eq(assets.campaignId, scope.campaignId)));
  const rows = await db
    .select()
    .from(assets)
    .where(and(ownedBy(owner), eq(assets.campaignId, scope.campaignId)))
    .orderBy(desc(assets.createdAt))
    .limit(VISUAL_LIMITS.listed);
  return visualsResponseSchema.parse({ visualAssetId, assets: rows.map(toSummary) });
}

/**
 * "Use this one" (D-42, ahead of F2.5's review): makes one of the record's or PC's own finished
 * tries its visual, and marks that try approved. Callers check `assertGm` and `assertWritable`.
 */
export async function useVisual(
  db: Database,
  scope: CampaignScope,
  owner: VisualOwner,
  assetId: string,
): Promise<VisualsResponse> {
  await loadVisualSource(db, scope, owner);
  await db.transaction(async (tx) => {
    const [asset] = await tx
      .select({ id: assets.id, status: assets.status })
      .from(assets)
      .where(and(eq(assets.id, assetId), eq(assets.campaignId, scope.campaignId), ownedBy(owner)))
      .for('update');
    if (asset === undefined) throw httpError(404, ASSET_NOT_FOUND);
    if (asset.status !== 'pending' && asset.status !== 'approved') {
      throw httpError(409, 'Only a finished image can be used');
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
  });
  return listVisuals(db, scope, owner);
}

/**
 * Where an asset's image is stored: the processed one unless the original is asked for, or
 * the original while nothing has been processed. 404 for another campaign's asset or one with
 * no image yet.
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
    .where(and(eq(assets.id, assetId), eq(assets.campaignId, scope.campaignId)));
  if (row?.original === null || row?.original === undefined) {
    throw httpError(404, ASSET_NOT_FOUND);
  }
  if (variant === 'processed' && row.processed !== null) {
    return { key: row.processed, mediaType: PROCESSED_MEDIA_TYPE };
  }
  return { key: row.original, mediaType: row.mediaType ?? 'image/png' };
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
    });
  return row ?? null;
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
        inArray(assets.status, ['pending', 'approved', 'rejected']),
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
        or(isNull(assets.processingVersion), lt(assets.processingVersion, version)),
      ),
    );
  if (row?.originalPath === null || row?.originalPath === undefined) return null;
  return { ...row, originalPath: row.originalPath };
}

/** Stores a (re)processed image. A newer version already stored is never replaced by an older. */
export async function saveProcessed(
  db: Database,
  assetId: string,
  processed: ProcessedFile,
): Promise<void> {
  await db
    .update(assets)
    .set(processedColumns(processed))
    .where(
      and(
        eq(assets.id, assetId),
        or(isNull(assets.processingVersion), lt(assets.processingVersion, processed.version)),
      ),
    );
}
