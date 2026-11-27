/**
 * The scenes part of the fake API (F3.2): scenes with their Spot, objects and suggestions, and
 * the builder's tray, following the server's rules and messages
 * (`apps/server/src/campaigns/scenes.ts`, D-49). A record with a `visualAssetId` has an image
 * for the stage (`STAGE_IMAGE_SIZE`); one without has none.
 */
import {
  createSceneRequestSchema,
  sceneObjectKindFor,
  setSceneObjectsRequestSchema,
  spotTypeOf,
  updateSceneRequestSchema,
  type Campaign,
  type CampaignRecord,
  type Scene,
  type SceneObject,
  type SceneObjectInput,
  type SceneSpot,
  type SceneSummary,
  type StageCharacter,
  type StageImage,
  type StageRecord,
  type StageRecordsResponse,
} from '@stagehand/shared';

/** The size and post-processing version of every stage image in the fake API. */
export const STAGE_IMAGE_SIZE = { width: 640, height: 1024, version: 3 } as const;

export const NO_IMAGE_MESSAGE = "A record with no image for the stage can't be placed in a scene";

/** A scene to start with. Its objects are as the builder would have saved them. */
export interface SceneSeed {
  id: string;
  name: string;
  spotId?: string | null;
  objects?: SceneObjectInput[];
  /** Its likely next scenes (F5.2), in order. */
  nextSceneIds?: string[];
}

export interface ScenesWorldOptions {
  /** Scenes already saved, by campaign id. */
  scenes?: Record<string, SceneSeed[]>;
  /** PCs with an image for the stage, by campaign id (the control desk's tray, F3.4). */
  stageCharacters?: Record<string, StageCharacter[]>;
}

interface Ctx {
  refused: (status: number, message: string) => Response;
  notFound: (message: string) => Response;
  invalid: (issues: { path: PropertyKey[]; message: string }[]) => Response;
}

interface StoredScene {
  id: string;
  name: string;
  spotId: string | null;
  objects: SceneObjectInput[];
  nextSceneIds: string[];
  updatedAt: string;
}

let nextId = 0;
const id = () => {
  nextId += 1;
  return `00000000-0000-4000-b000-${String(nextId).padStart(12, '0')}`;
};

/** The stage image of a record's visual in use, or null without one. */
export function stageImageOf(record: { visualAssetId: string | null }): StageImage | null {
  return record.visualAssetId === null
    ? null
    : { assetId: record.visualAssetId, ...STAGE_IMAGE_SIZE };
}

const byName = (a: { name: string }, b: { name: string }) =>
  a.name.toLowerCase().localeCompare(b.name.toLowerCase());

export function scenesWorld(options: ScenesWorldOptions, ctx: Ctx) {
  const stores = new Map<string, StoredScene[]>();
  const scenesOf = (campaignId: string): StoredScene[] => {
    let scenes = stores.get(campaignId);
    if (scenes === undefined) {
      scenes = (options.scenes?.[campaignId] ?? []).map((seed) => ({
        id: seed.id,
        name: seed.name,
        spotId: seed.spotId ?? null,
        objects: [...(seed.objects ?? [])],
        nextSceneIds: [...(seed.nextSceneIds ?? [])],
        updatedAt: '2026-11-14T10:00:00.000Z',
      }));
      stores.set(campaignId, scenes);
    }
    return scenes;
  };

  function respond(
    found: Campaign,
    records: readonly CampaignRecord[],
    rest: string,
    method: string,
    rawBody: unknown,
  ): Response | null {
    const sceneMatch = /^\/scenes\/([^/]+)(\/objects)?$/.exec(rest);
    if (rest !== '/scenes' && rest !== '/stage-records' && sceneMatch === null) return null;
    if (found.role !== 'gm') return ctx.refused(403, 'Only the GM can do that');

    const recordOf = (recordId: string) => records.find((r) => r.id === recordId);
    const toStageRecord = (record: CampaignRecord): StageRecord[] => {
      const kind = sceneObjectKindFor(record.type);
      return kind === null
        ? []
        : [
            {
              record: { id: record.id, type: record.type, name: record.name },
              kind,
              image: stageImageOf(record),
            },
          ];
    };
    const toSpot = (spot: CampaignRecord): SceneSpot => ({
      id: spot.id,
      name: spot.name,
      areaName: records.find((r) => r.id === spot.parentId)?.name ?? null,
      backdrop: stageImageOf(spot),
    });
    const spotOf = (spotId: string | null) => {
      const spot = spotId === null ? undefined : recordOf(spotId);
      return spot?.type === 'spot' ? spot : null;
    };
    /** Like the server: objects of deleted records are gone, and images are those in use. */
    const present = (scene: StoredScene): Scene => {
      const spot = spotOf(scene.spotId);
      const suggested = new Map<string, CampaignRecord>();
      if (spot !== null) {
        for (const prop of records) {
          if (prop.type === 'prop' && prop.links['spot']?.some((ref) => ref.id === spot.id)) {
            suggested.set(prop.id, prop);
          }
        }
        for (const key of ['npcsHere', 'itemsHere']) {
          for (const ref of spot.links[key] ?? []) {
            const linked = recordOf(ref.id);
            if (linked !== undefined) suggested.set(linked.id, linked);
          }
        }
      }
      return {
        id: scene.id,
        name: scene.name,
        // Like the server: a scene is of its Spot's type (F5.4).
        type: spot === null ? 'static' : spotTypeOf(spot.fields),
        spot: spot === null ? null : toSpot(spot),
        objects: scene.objects.flatMap((object): SceneObject[] => {
          const record = recordOf(object.recordId);
          const kind = record === undefined ? null : sceneObjectKindFor(record.type);
          if (record === undefined || kind === null) return [];
          return [
            {
              id: object.id,
              kind,
              record: { id: record.id, type: record.type, name: record.name },
              image: stageImageOf(record),
              across: object.across,
              up: object.up,
              depthTick: object.depthTick,
              scale: object.scale,
              flipped: object.flipped,
              shown: kind === 'prop' ? (object.shown ?? true) : false,
              mount: kind === 'prop' ? (object.mount ?? 'stand') : null,
              travelMode: kind === 'puppet' ? (object.travelMode ?? 'walking') : null,
            },
          ];
        }),
        suggestions: [...suggested.values()].sort(byName).flatMap(toStageRecord),
        // Like the server: a deleted scene is gone from every list.
        nextScenes: liveNext(scene).map((next) => ({ id: next.id, name: next.name })),
        createdAt: '2026-11-14T10:00:00.000Z',
        updatedAt: scene.updatedAt,
      };
    };

    const scenes = scenesOf(found.id);
    function liveNext(scene: StoredScene): StoredScene[] {
      return scene.nextSceneIds.flatMap((nextId) => scenes.filter((other) => other.id === nextId));
    }
    const archived = () =>
      found.archivedAt === null ? null : ctx.refused(409, 'Campaign is archived');

    if (rest === '/stage-records') {
      if (method !== 'GET') return null;
      const response: StageRecordsResponse = {
        records: [...records]
          .sort(byName)
          .flatMap(toStageRecord)
          .filter((entry) => entry.image !== null),
        spots: records
          .filter((r) => r.type === 'spot')
          .sort(byName)
          .map(toSpot),
        characters: options.stageCharacters?.[found.id] ?? [],
      };
      return Response.json(response);
    }

    if (sceneMatch === null) {
      if (method === 'GET') {
        const summaries: SceneSummary[] = [...scenes].sort(byName).map((scene) => {
          const shown = present(scene);
          return {
            id: shown.id,
            name: shown.name,
            type: shown.type,
            spot: shown.spot === null ? null : { id: shown.spot.id, name: shown.spot.name },
            objectCount: shown.objects.length,
            nextSceneIds: shown.nextScenes.map((next) => next.id),
            updatedAt: shown.updatedAt,
          };
        });
        return Response.json({ scenes: summaries });
      }
      if (method === 'POST') {
        const refusal = archived();
        if (refusal !== null) return refusal;
        const parsed = createSceneRequestSchema.safeParse(rawBody);
        if (!parsed.success) return ctx.invalid(parsed.error.issues);
        const spotId = parsed.data.spotId ?? null;
        if (spotId !== null && spotOf(spotId) === null) return ctx.notFound('Spot not found');
        const created: StoredScene = {
          id: id(),
          name: parsed.data.name,
          spotId,
          objects: [],
          nextSceneIds: [],
          updatedAt: '2026-11-14T11:00:00.000Z',
        };
        scenes.push(created);
        return Response.json(present(created), { status: 201 });
      }
      return null;
    }

    const scene = scenes.find((candidate) => candidate.id === sceneMatch[1]);
    if (scene === undefined) return ctx.notFound('Scene not found');

    if (sceneMatch[2] !== undefined) {
      if (method !== 'PUT') return null;
      const refusal = archived();
      if (refusal !== null) return refusal;
      const parsed = setSceneObjectsRequestSchema.safeParse(rawBody);
      if (!parsed.success) return ctx.invalid(parsed.error.issues);
      const already = new Set(scene.objects.map((object) => object.id));
      const puppets = new Set<string>();
      for (const object of parsed.data.objects) {
        const record = recordOf(object.recordId);
        if (record === undefined) return ctx.notFound('Record not found');
        const kind = sceneObjectKindFor(record.type);
        if (kind === null) {
          return ctx.refused(400, 'Only Props, Items and NPCs can be placed in a scene');
        }
        if (stageImageOf(record) === null && !already.has(object.id)) {
          return ctx.refused(400, NO_IMAGE_MESSAGE);
        }
        if (kind === 'puppet') {
          if (object.shown === true || object.mount !== undefined) {
            return ctx.refused(
              400,
              'Only props can be shown or hung: a puppet starts lowered, on a stick',
            );
          }
          if (puppets.has(record.id)) {
            return ctx.refused(400, 'An NPC can only be in a scene once');
          }
          puppets.add(record.id);
        }
      }
      scene.objects = parsed.data.objects;
      scene.updatedAt = '2026-11-14T12:00:00.000Z';
      return Response.json(present(scene));
    }

    if (method === 'GET') return Response.json(present(scene));
    const refusal = archived();
    if (refusal !== null) return refusal;
    if (method === 'PATCH') {
      const parsed = updateSceneRequestSchema.safeParse(rawBody);
      if (!parsed.success) return ctx.invalid(parsed.error.issues);
      const { name, spotId, nextSceneIds } = parsed.data;
      if (spotId != null && spotOf(spotId) === null) return ctx.notFound('Spot not found');
      if (nextSceneIds?.includes(scene.id) === true) {
        return ctx.refused(400, "A scene can't lead to itself");
      }
      if (nextSceneIds?.some((nextId) => !scenes.some((other) => other.id === nextId)) === true) {
        return ctx.notFound('Scene not found');
      }
      if (name !== undefined) scene.name = name;
      if (spotId !== undefined) scene.spotId = spotId;
      if (nextSceneIds !== undefined) scene.nextSceneIds = nextSceneIds;
      scene.updatedAt = '2026-11-14T12:00:00.000Z';
      return Response.json(present(scene));
    }
    if (method === 'DELETE') {
      scenes.splice(scenes.indexOf(scene), 1);
      return new Response(null, { status: 204 });
    }
    return null;
  }

  return { respond };
}
