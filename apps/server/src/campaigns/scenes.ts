/**
 * Scenes (F3.2, governance §8 and §12 "Scene builder", D-49). Part of the campaign data-access
 * layer: every query is scoped to `scope.campaignId`, so a Spot, record or scene of another
 * campaign is never found. GM only; callers check `assertGm`, and `assertWritable` for writes.
 *
 * A scene is drawn with images in use, never stored ones: its backdrop is its Spot's, and each
 * object shows its record's. `campaigns/visuals.ts` reads them (`stageImagesOf`).
 *
 * A scene's type is its Spot's, read with it (F5.4, D-75): a scene from a transition Spot is a
 * transition scene, whose props are always saved hidden, since they pass by while it plays.
 */
import {
  RECORD_TYPES,
  sceneObjectKindFor,
  sceneSchema,
  sceneSummarySchema,
  spotTypeOf,
  stageRecordsResponseSchema,
  type CreateSceneRequest,
  type RECORD_FIELD_SPECS,
  type RecordType,
  type Scene,
  type SceneObjectInput,
  type SceneSpot,
  type SceneSummary,
  type SceneType,
  type StageImage,
  type StageRecord,
  type StageRecordsResponse,
  type UpdateSceneRequest,
} from '@stagehand/shared';
import { and, asc, count, eq, inArray, isNotNull, ne, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import type { Database } from '../db/client';
import { characters, recordLinks, records, sceneNext, sceneObjects, scenes } from '../db/schema';
import { httpError } from '../http/errors';

import type { DbOrTx } from './members';
import type { CampaignScope } from './scope';
import { stageImagesOf } from './visuals';

type SceneRow = typeof scenes.$inferSelect;

const NOT_FOUND = 'Scene not found';
const SPOT_NOT_FOUND = 'Spot not found';

/** The record types that can be placed in a scene: Props, Items and NPCs. */
const PLACEABLE_TYPES = RECORD_TYPES.filter((type) => sceneObjectKindFor(type) !== null);

/** A Spot's own link fields that suggest what to place there (§8). */
const SPOT_SUGGESTION_FIELDS = [
  'npcsHere',
  'itemsHere',
] as const satisfies readonly (keyof typeof RECORD_FIELD_SPECS.spot)[];
/** A Prop's link to its Spot: the stored side of a Spot's "Props here" (D-41). */
const PROP_SPOT_FIELD = 'spot' satisfies keyof typeof RECORD_FIELD_SPECS.prop;

/** What a scene needs to know about a record it shows. */
interface StageSource {
  id: string;
  type: RecordType;
  name: string;
  visualAssetId: string | null;
}

/** `id = sceneId and campaign_id = scope.campaignId`. */
function scoped(scope: CampaignScope, sceneId: string) {
  return and(eq(scenes.id, sceneId), eq(scenes.campaignId, scope.campaignId));
}

const byName = (a: { name: string }, b: { name: string }) =>
  a.name.toLowerCase().localeCompare(b.name.toLowerCase()) || a.name.localeCompare(b.name);

/** A scene's type from its Spot's stored fields (F5.4): static with no Spot. */
function sceneTypeOf(spotFields: Record<string, unknown> | null): SceneType {
  return spotFields === null ? 'static' : spotTypeOf(spotFields);
}

/** A Spot of this campaign with its Area's name, or null. */
async function loadSpot(db: DbOrTx, scope: CampaignScope, spotId: string) {
  const area = alias(records, 'area');
  const [row] = await db
    .select({
      id: records.id,
      name: records.name,
      areaName: area.name,
      visualAssetId: records.visualAssetId,
      fields: records.fields,
    })
    .from(records)
    .leftJoin(area, and(eq(area.id, records.parentId), eq(area.campaignId, records.campaignId)))
    .where(
      and(
        eq(records.id, spotId),
        eq(records.campaignId, scope.campaignId),
        eq(records.type, 'spot'),
      ),
    );
  return row ?? null;
}

/** 404 unless `spotId` is a Spot of this campaign. */
async function requireSpot(db: DbOrTx, scope: CampaignScope, spotId: string): Promise<void> {
  if ((await loadSpot(db, scope, spotId)) === null) throw httpError(404, SPOT_NOT_FOUND);
}

function toSpot(
  spot: { id: string; name: string; areaName: string | null; visualAssetId: string | null },
  images: ReadonlyMap<string, StageImage>,
): SceneSpot {
  return {
    id: spot.id,
    name: spot.name,
    areaName: spot.areaName,
    backdrop: spot.visualAssetId === null ? null : (images.get(spot.visualAssetId) ?? null),
  };
}

/** A placeable record with its image; other record types are left out. */
function toStageRecords(
  sources: readonly StageSource[],
  images: ReadonlyMap<string, StageImage>,
): StageRecord[] {
  return sources.flatMap((source) => {
    const kind = sceneObjectKindFor(source.type);
    if (kind === null) return [];
    return [
      {
        record: { id: source.id, type: source.type, name: source.name },
        kind,
        image: source.visualAssetId === null ? null : (images.get(source.visualAssetId) ?? null),
      },
    ];
  });
}

/**
 * What a Spot suggests for its scene (§12): the Props placed there, and its NPCs usually here
 * and Items here, each once, by name.
 */
async function suggestionsFor(
  db: DbOrTx,
  scope: CampaignScope,
  spotId: string,
): Promise<StageSource[]> {
  const columns = {
    id: records.id,
    type: records.type,
    name: records.name,
    visualAssetId: records.visualAssetId,
  };
  const fieldLink = and(
    eq(recordLinks.campaignId, scope.campaignId),
    eq(recordLinks.kind, 'field'),
  );
  const linkedFromSpot = await db
    .select(columns)
    .from(recordLinks)
    .innerJoin(
      records,
      and(eq(records.id, recordLinks.toRecordId), eq(records.campaignId, recordLinks.campaignId)),
    )
    .where(
      and(
        fieldLink,
        eq(recordLinks.fromRecordId, spotId),
        inArray(recordLinks.fieldKey, [...SPOT_SUGGESTION_FIELDS]),
      ),
    );
  const propsHere = await db
    .select(columns)
    .from(recordLinks)
    .innerJoin(
      records,
      and(eq(records.id, recordLinks.fromRecordId), eq(records.campaignId, recordLinks.campaignId)),
    )
    .where(
      and(
        fieldLink,
        eq(recordLinks.toRecordId, spotId),
        eq(recordLinks.fieldKey, PROP_SPOT_FIELD),
        eq(records.type, 'prop'),
      ),
    );

  const unique = new Map<string, StageSource>();
  for (const row of [...propsHere, ...linkedFromSpot]) unique.set(row.id, row);
  return [...unique.values()].sort(byName);
}

/** The API shape of a scene: its Spot, its objects in order, and the Spot's suggestions. */
async function toScene(db: DbOrTx, scope: CampaignScope, row: SceneRow): Promise<Scene> {
  const spot = row.spotId === null ? null : await loadSpot(db, scope, row.spotId);
  const placed = await db
    .select({
      object: sceneObjects,
      type: records.type,
      name: records.name,
      visualAssetId: records.visualAssetId,
    })
    .from(sceneObjects)
    .innerJoin(
      records,
      and(eq(records.id, sceneObjects.recordId), eq(records.campaignId, sceneObjects.campaignId)),
    )
    .where(and(eq(sceneObjects.sceneId, row.id), eq(sceneObjects.campaignId, scope.campaignId)))
    .orderBy(asc(sceneObjects.position));
  const suggested = spot === null ? [] : await suggestionsFor(db, scope, spot.id);
  const nextScenes = await db
    .select({ id: scenes.id, name: scenes.name })
    .from(sceneNext)
    .innerJoin(
      scenes,
      and(eq(scenes.id, sceneNext.nextSceneId), eq(scenes.campaignId, sceneNext.campaignId)),
    )
    .where(and(eq(sceneNext.sceneId, row.id), eq(sceneNext.campaignId, scope.campaignId)))
    .orderBy(asc(sceneNext.position));

  const assetIds = [spot, ...placed, ...suggested].flatMap((source) => {
    const assetId = source?.visualAssetId ?? null;
    return assetId === null ? [] : [assetId];
  });
  const images = await stageImagesOf(db, scope, assetIds);

  return sceneSchema.parse({
    id: row.id,
    name: row.name,
    type: sceneTypeOf(spot?.fields ?? null),
    spot: spot === null ? null : toSpot(spot, images),
    objects: placed.map(({ object, type, name, visualAssetId }) => ({
      id: object.id,
      kind: object.kind,
      record: { id: object.recordId, type, name },
      image: visualAssetId === null ? null : (images.get(visualAssetId) ?? null),
      across: object.across,
      up: object.up,
      depthTick: object.depthTick,
      scale: object.scale,
      flipped: object.flipped,
      shown: object.shown,
      mount: object.mount,
      travelMode: object.travelMode,
    })),
    suggestions: toStageRecords(suggested, images),
    nextScenes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}

/**
 * A scene as a live session copies it onto the stage (F3.3): its Spot and its objects' rows, in
 * list order. Null when the scene isn't in this campaign.
 */
export async function sceneForStage(
  db: DbOrTx,
  scope: CampaignScope,
  sceneId: string,
): Promise<{
  name: string;
  spotId: string | null;
  /** Its Spot is a transition Spot (F5.4). */
  transition: boolean;
  objects: (typeof sceneObjects.$inferSelect)[];
} | null> {
  const [scene] = await db
    .select({ name: scenes.name, spotId: scenes.spotId })
    .from(scenes)
    .where(scoped(scope, sceneId));
  if (scene === undefined) return null;
  const spot = scene.spotId === null ? null : await loadSpot(db, scope, scene.spotId);
  const objects = await db
    .select()
    .from(sceneObjects)
    .where(and(eq(sceneObjects.sceneId, sceneId), eq(sceneObjects.campaignId, scope.campaignId)))
    .orderBy(asc(sceneObjects.position));
  return {
    name: scene.name,
    spotId: scene.spotId,
    transition: sceneTypeOf(spot?.fields ?? null) === 'transition',
    objects,
  };
}

/** Every scene in the campaign, by name, with its Spot and how many objects it holds. */
export async function listScenes(db: Database, scope: CampaignScope): Promise<SceneSummary[]> {
  const spot = alias(records, 'spot');
  const rows = await db
    .select({
      id: scenes.id,
      name: scenes.name,
      spotId: spot.id,
      spotName: spot.name,
      spotFields: spot.fields,
      objectCount: count(sceneObjects.id),
      updatedAt: scenes.updatedAt,
    })
    .from(scenes)
    .leftJoin(spot, and(eq(spot.id, scenes.spotId), eq(spot.campaignId, scenes.campaignId)))
    .leftJoin(sceneObjects, eq(sceneObjects.sceneId, scenes.id))
    .where(eq(scenes.campaignId, scope.campaignId))
    .groupBy(scenes.id, spot.id)
    .orderBy(asc(sql`lower(${scenes.name})`), asc(scenes.createdAt));

  const links = await db
    .select({ sceneId: sceneNext.sceneId, nextSceneId: sceneNext.nextSceneId })
    .from(sceneNext)
    .where(eq(sceneNext.campaignId, scope.campaignId))
    .orderBy(asc(sceneNext.sceneId), asc(sceneNext.position));
  const nextOf = new Map<string, string[]>();
  for (const link of links) {
    const list = nextOf.get(link.sceneId) ?? [];
    list.push(link.nextSceneId);
    nextOf.set(link.sceneId, list);
  }

  return rows.map((row) =>
    sceneSummarySchema.parse({
      id: row.id,
      name: row.name,
      type: sceneTypeOf(row.spotId === null ? null : row.spotFields),
      spot:
        row.spotId === null || row.spotName === null
          ? null
          : { id: row.spotId, name: row.spotName },
      objectCount: row.objectCount,
      nextSceneIds: nextOf.get(row.id) ?? [],
      updatedAt: row.updatedAt.toISOString(),
    }),
  );
}

export async function getScene(
  db: Database,
  scope: CampaignScope,
  sceneId: string,
): Promise<Scene> {
  const [row] = await db.select().from(scenes).where(scoped(scope, sceneId));
  if (row === undefined) throw httpError(404, NOT_FOUND);
  return toScene(db, scope, row);
}

/**
 * Creates an empty scene, with a Spot's backdrop and type when one is given, else static.
 * Nothing is placed: the Spot's Props, NPCs and Items come back as suggestions for the GM.
 */
export async function createScene(
  db: Database,
  scope: CampaignScope,
  request: CreateSceneRequest,
): Promise<Scene> {
  const spotId = request.spotId ?? null;
  if (spotId !== null) await requireSpot(db, scope, spotId);
  const [row] = await db
    .insert(scenes)
    .values({ campaignId: scope.campaignId, name: request.name, spotId })
    .returning();
  if (row === undefined) throw new Error('scene insert returned no row');
  return toScene(db, scope, row);
}

/**
 * Renames a scene, gives it another Spot (or none), or replaces its likely next scenes (F5.2):
 * other scenes of this campaign, in order, never itself. Last write wins.
 */
export async function updateScene(
  db: Database,
  scope: CampaignScope,
  sceneId: string,
  patch: UpdateSceneRequest,
): Promise<Scene> {
  if (patch.spotId != null) await requireSpot(db, scope, patch.spotId);
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(scenes)
      .set({
        ...(patch.name === undefined ? {} : { name: patch.name }),
        ...(patch.spotId === undefined ? {} : { spotId: patch.spotId }),
        // Always something to set, so a change to the list alone still moves `updatedAt` on.
        updatedAt: new Date(),
      })
      .where(scoped(scope, sceneId))
      .returning();
    if (row === undefined) throw httpError(404, NOT_FOUND);
    if (patch.nextSceneIds !== undefined)
      await setNextScenes(tx, scope, row.id, patch.nextSceneIds);
    return toScene(tx, scope, row);
  });
}

/** Makes `sceneId` list exactly `nextSceneIds`, in that order (F5.2). */
async function setNextScenes(
  tx: DbOrTx,
  scope: CampaignScope,
  sceneId: string,
  nextSceneIds: readonly string[],
): Promise<void> {
  if (nextSceneIds.includes(sceneId)) throw httpError(400, "A scene can't lead to itself");
  if (nextSceneIds.length > 0) {
    const found = await tx
      .select({ id: scenes.id })
      .from(scenes)
      .where(and(inArray(scenes.id, [...nextSceneIds]), eq(scenes.campaignId, scope.campaignId)));
    if (found.length !== nextSceneIds.length) throw httpError(404, NOT_FOUND);
  }
  await tx
    .delete(sceneNext)
    .where(and(eq(sceneNext.sceneId, sceneId), eq(sceneNext.campaignId, scope.campaignId)));
  if (nextSceneIds.length === 0) return;
  await tx.insert(sceneNext).values(
    nextSceneIds.map((nextSceneId, position) => ({
      sceneId,
      nextSceneId,
      campaignId: scope.campaignId,
      position,
    })),
  );
}

/** Deletes a scene and everything placed in it. The records themselves are untouched. */
export async function deleteScene(
  db: Database,
  scope: CampaignScope,
  sceneId: string,
): Promise<void> {
  const deleted = await db
    .delete(scenes)
    .where(scoped(scope, sceneId))
    .returning({ id: scenes.id });
  if (deleted.length === 0) throw httpError(404, NOT_FOUND);
}

/**
 * Makes the scene hold exactly `list`, in that order (D-49): objects left out are removed.
 *
 * Each object's kind comes from its record: a Prop or Item is a prop, an NPC a puppet, and no
 * other type can be placed. A newly placed record needs an image for the stage; an object that
 * was already in the scene keeps its place even if its record has lost its image. A puppet is
 * saved lowered and on its stick, so `shown` and `mount` are refused for one, and an NPC can be
 * placed once. A puppet walks unless it is set stationary (F5.4); a prop has no travel mode.
 * In a transition scene every prop is saved hidden: it passes by once shown (F5.4). Nothing is
 * written unless the whole list is good.
 */
export async function setSceneObjects(
  db: Database,
  scope: CampaignScope,
  sceneId: string,
  list: readonly SceneObjectInput[],
): Promise<Scene> {
  return db.transaction(async (tx) => {
    const [scene] = await tx.select().from(scenes).where(scoped(scope, sceneId)).for('update');
    if (scene === undefined) throw httpError(404, NOT_FOUND);
    const spot = scene.spotId === null ? null : await loadSpot(tx, scope, scene.spotId);
    const transition = sceneTypeOf(spot?.fields ?? null) === 'transition';

    const ids = list.map((object) => object.id);
    const recordIds = [...new Set(list.map((object) => object.recordId))];
    const sources =
      recordIds.length === 0
        ? []
        : await tx
            .select({
              id: records.id,
              type: records.type,
              name: records.name,
              visualAssetId: records.visualAssetId,
            })
            .from(records)
            .where(and(eq(records.campaignId, scope.campaignId), inArray(records.id, recordIds)));
    const sourceOf = new Map(sources.map((source) => [source.id, source]));
    const images = await stageImagesOf(
      tx,
      scope,
      sources.flatMap((source) => (source.visualAssetId === null ? [] : [source.visualAssetId])),
    );
    const already = new Set(
      (
        await tx
          .select({ id: sceneObjects.id })
          .from(sceneObjects)
          .where(
            and(eq(sceneObjects.sceneId, sceneId), eq(sceneObjects.campaignId, scope.campaignId)),
          )
      ).map((row) => row.id),
    );

    const puppets = new Set<string>();
    const rows = list.map((object, position) => {
      const source = sourceOf.get(object.recordId);
      if (source === undefined) throw httpError(404, 'Record not found');
      const kind = sceneObjectKindFor(source.type);
      if (kind === null) {
        throw httpError(400, 'Only Props, Items and NPCs can be placed in a scene');
      }
      const hasImage = source.visualAssetId !== null && images.has(source.visualAssetId);
      if (!hasImage && !already.has(object.id)) {
        throw httpError(400, "A record with no image for the stage can't be placed in a scene");
      }
      if (kind === 'puppet') {
        if (object.shown === true || object.mount !== undefined) {
          throw httpError(
            400,
            'Only props can be shown or hung: a puppet starts lowered, on a stick',
          );
        }
        if (puppets.has(source.id)) throw httpError(400, 'An NPC can only be in a scene once');
        puppets.add(source.id);
      } else if (object.travelMode !== undefined) {
        throw httpError(400, 'Only NPC puppets walk or stay where they are');
      }
      return {
        id: object.id,
        sceneId,
        campaignId: scope.campaignId,
        kind,
        recordId: source.id,
        across: object.across,
        up: object.up,
        depthTick: object.depthTick,
        scale: object.scale,
        flipped: object.flipped,
        shown: kind === 'prop' && !transition ? (object.shown ?? true) : false,
        mount: kind === 'prop' ? (object.mount ?? 'stand') : null,
        travelMode: kind === 'puppet' ? (object.travelMode ?? 'walking') : null,
        position,
      };
    });

    // The browser makes object ids, so one could arrive that another scene already uses.
    if (ids.length > 0) {
      const [taken] = await tx
        .select({ id: sceneObjects.id })
        .from(sceneObjects)
        .where(
          and(
            eq(sceneObjects.campaignId, scope.campaignId),
            inArray(sceneObjects.id, ids),
            ne(sceneObjects.sceneId, sceneId),
          ),
        )
        .limit(1);
      if (taken !== undefined)
        throw httpError(409, 'An object id is already used by another scene');
    }

    await tx
      .delete(sceneObjects)
      .where(and(eq(sceneObjects.sceneId, sceneId), eq(sceneObjects.campaignId, scope.campaignId)));
    if (rows.length > 0) await tx.insert(sceneObjects).values(rows);
    const [saved] = await tx
      .update(scenes)
      .set({ updatedAt: new Date() })
      .where(scoped(scope, sceneId))
      .returning();
    return toScene(tx, scope, saved ?? scene);
  });
}

/**
 * What the builder's tray offers (§12): every Prop, Item and NPC with an image for the stage,
 * and every Spot with its backdrop if it has one, each by name. The control desk's tray (F3.4)
 * adds every PC with an image for the stage.
 */
export async function listStageRecords(
  db: Database,
  scope: CampaignScope,
): Promise<StageRecordsResponse> {
  const nameOrder = [asc(sql`lower(${records.name})`), asc(records.createdAt)];
  const placeable = await db
    .select({
      id: records.id,
      type: records.type,
      name: records.name,
      visualAssetId: records.visualAssetId,
    })
    .from(records)
    .where(
      and(
        eq(records.campaignId, scope.campaignId),
        inArray(records.type, PLACEABLE_TYPES),
        isNotNull(records.visualAssetId),
      ),
    )
    .orderBy(...nameOrder);

  const area = alias(records, 'area');
  const spots = await db
    .select({
      id: records.id,
      name: records.name,
      areaName: area.name,
      visualAssetId: records.visualAssetId,
    })
    .from(records)
    .leftJoin(area, and(eq(area.id, records.parentId), eq(area.campaignId, records.campaignId)))
    .where(and(eq(records.campaignId, scope.campaignId), eq(records.type, 'spot')))
    .orderBy(...nameOrder);

  const pcs = await db
    .select({ id: characters.id, name: characters.name, visualAssetId: characters.visualAssetId })
    .from(characters)
    .where(and(eq(characters.campaignId, scope.campaignId), isNotNull(characters.visualAssetId)))
    .orderBy(asc(sql`lower(${characters.name})`), asc(characters.createdAt));

  const images = await stageImagesOf(
    db,
    scope,
    [...placeable, ...spots, ...pcs].flatMap((row) =>
      row.visualAssetId === null ? [] : [row.visualAssetId],
    ),
  );
  return stageRecordsResponseSchema.parse({
    records: toStageRecords(placeable, images).filter((entry) => entry.image !== null),
    spots: spots.map((spot) => toSpot(spot, images)),
    characters: pcs.flatMap((pc) => {
      const image = pc.visualAssetId === null ? undefined : images.get(pc.visualAssetId);
      return image === undefined ? [] : [{ id: pc.id, name: pc.name, image }];
    }),
  });
}
