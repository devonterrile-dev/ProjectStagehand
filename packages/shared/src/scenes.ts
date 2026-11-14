/**
 * Scenes (F3.2, governance §8 and §12 "Scene builder", D-49): a saved arrangement of the
 * theater. A scene has a name, optionally a Spot whose image in use is its backdrop, and up to
 * `SCENE_MAX_OBJECTS` placed objects: props (Prop and Item records) and NPC puppets. PCs are
 * never saved in a scene; the GM raises them live (D-36). GM only.
 */
import { z } from 'zod';

import type { RecordType } from './record-fields';
import { recordRefSchema } from './record-links';
import { depthTickSchema, SESSION_MAX_PLAYERS, STAGE_MAX_OBJECTS } from './stage';

/** Longest scene name, the same as a record's. The database enforces it too. */
export const SCENE_NAME_MAX = 120;

export const sceneNameSchema = z
  .string()
  .trim()
  .min(1, 'Scene name cannot be empty')
  .max(SCENE_NAME_MAX, `Scene name must be ${String(SCENE_NAME_MAX)} characters or fewer`);

/** §12 "Scene types". Only `static` can be made until Phase 4 (F4.1, F4.2). */
export const SCENE_TYPES = ['static', 'transition', 'battle'] as const;
export const sceneTypeSchema = z.enum(SCENE_TYPES);
export type SceneType = z.infer<typeof sceneTypeSchema>;

/** A prop stands in the scene; a puppet is on a stick and waits below until it is raised. */
export const SCENE_OBJECT_KINDS = ['prop', 'puppet'] as const;
export const sceneObjectKindSchema = z.enum(SCENE_OBJECT_KINDS);
export type SceneObjectKind = z.infer<typeof sceneObjectKindSchema>;

/** How a prop is held (§12): on a stand from below, or on a string from the roof. */
export const PROP_MOUNTS = ['stand', 'hang'] as const;
export const propMountSchema = z.enum(PROP_MOUNTS);
export type PropMount = z.infer<typeof propMountSchema>;

/**
 * Most objects a saved scene holds: the §12 budget less a seat for each player's PC, which the
 * GM adds live.
 */
export const SCENE_MAX_OBJECTS = STAGE_MAX_OBJECTS - SESSION_MAX_PLAYERS;

/** An object's size against its image's own (1). The database checks the same range. */
export const SCENE_SCALE = { min: 0.25, max: 2.5, initial: 1 } as const;

const PLACED_AS: Partial<Record<RecordType, SceneObjectKind>> = {
  prop: 'prop',
  item: 'prop',
  npc: 'puppet',
};

/** What a record becomes when placed in a scene, or null if its type can't be placed. */
export function sceneObjectKindFor(type: RecordType): SceneObjectKind | null {
  return PLACED_AS[type] ?? null;
}

/** 0 to 1 across the theater's opening (left to right), or up it (bottom to top). */
const unitSchema = z
  .number()
  .min(0, 'Must be inside the opening')
  .max(1, 'Must be inside the opening');

const scaleSchema = z
  .number()
  .min(SCENE_SCALE.min, `Scale must be ${String(SCENE_SCALE.min)} or more`)
  .max(SCENE_SCALE.max, `Scale must be ${String(SCENE_SCALE.max)} or less`);

const timestamp = z.iso.datetime({ offset: true });

/**
 * The stage's version of an image in use (F2.4): which asset, its size in pixels and the
 * post-processing version that made it. `assetImagePath` turns it into a URL.
 */
export const stageImageSchema = z.object({
  assetId: z.uuid(),
  width: z.int().positive(),
  height: z.int().positive(),
  version: z.int().positive(),
});
export type StageImage = z.infer<typeof stageImageSchema>;

/** A record that can go in a scene, and its image. Null: no image for the stage yet. */
export const stageRecordSchema = z.object({
  record: recordRefSchema,
  kind: sceneObjectKindSchema,
  image: stageImageSchema.nullable(),
});
export type StageRecord = z.infer<typeof stageRecordSchema>;

/** A Spot as a scene's backdrop. `backdrop` is null while the Spot has no image in use. */
export const sceneSpotSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  /** The Spot's Area. */
  areaName: z.string().nullable(),
  backdrop: stageImageSchema.nullable(),
});
export type SceneSpot = z.infer<typeof sceneSpotSchema>;

/** One placed prop or puppet. Its place is that of the bottom center of its cutout. */
export const sceneObjectSchema = z.object({
  id: z.uuid(),
  kind: sceneObjectKindSchema,
  record: recordRefSchema,
  /** The record's image in use; a scene follows it when the GM replaces it. */
  image: stageImageSchema.nullable(),
  across: z.number(),
  /** For a puppet, how high it rises: it is saved lowered, waiting in the void. */
  up: z.number(),
  depthTick: depthTickSchema,
  scale: z.number(),
  flipped: z.boolean(),
  /** A prop placed but hidden is false. Always false for a puppet. */
  shown: z.boolean(),
  /** Null for a puppet, which is always on a stick. */
  mount: propMountSchema.nullable(),
});
export type SceneObject = z.infer<typeof sceneObjectSchema>;

/** A full scene, as the builder loads it. */
export const sceneSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  type: sceneTypeSchema,
  spot: sceneSpotSchema.nullable(),
  /** In list order: later objects on the same depth tick are drawn in front. */
  objects: z.array(sceneObjectSchema),
  /** The Spot's Props here, NPCs usually here and Items here, sorted by name. */
  suggestions: z.array(stageRecordSchema),
  createdAt: timestamp,
  updatedAt: timestamp,
});
export type Scene = z.infer<typeof sceneSchema>;

/** A scene in a list. */
export const sceneSummarySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  type: sceneTypeSchema,
  spot: z.object({ id: z.uuid(), name: z.string() }).nullable(),
  objectCount: z.int(),
  updatedAt: timestamp,
});
export type SceneSummary = z.infer<typeof sceneSummarySchema>;

/** `GET /api/campaigns/:campaignId/scenes`. GM only. Sorted by name. */
export const sceneListResponseSchema = z.object({ scenes: z.array(sceneSummarySchema) });
export type SceneListResponse = z.infer<typeof sceneListResponseSchema>;

/**
 * `POST /api/campaigns/:campaignId/scenes`. GM only; refused while archived. Always a static
 * scene. With a Spot, the scene starts with its backdrop; without, an empty theater.
 */
export const createSceneRequestSchema = z.strictObject({
  name: sceneNameSchema,
  spotId: z.uuid().nullable().optional(),
});
export type CreateSceneRequest = z.infer<typeof createSceneRequestSchema>;

/** `PATCH …/scenes/:sceneId`. Any subset of the keys; a null Spot leaves the back wall bare. */
export const updateSceneRequestSchema = z
  .strictObject({
    name: sceneNameSchema.optional(),
    spotId: z.uuid().nullable().optional(),
  })
  .refine((patch) => Object.keys(patch).length > 0, 'Nothing to update');
export type UpdateSceneRequest = z.infer<typeof updateSceneRequestSchema>;

/**
 * One object as the builder saves it. The browser makes the id, so an object keeps it from
 * the moment it is placed. Its kind comes from the record's type on the server. `shown` and
 * `mount` are for props only: left out, a prop is shown and on a stand.
 */
export const sceneObjectInputSchema = z.strictObject({
  id: z.uuid(),
  recordId: z.uuid(),
  across: unitSchema,
  up: unitSchema,
  depthTick: depthTickSchema,
  scale: scaleSchema,
  flipped: z.boolean(),
  shown: z.boolean().optional(),
  mount: propMountSchema.optional(),
});
export type SceneObjectInput = z.infer<typeof sceneObjectInputSchema>;

/**
 * `PUT …/scenes/:sceneId/objects`: the scene's whole list of objects, in order. Objects left
 * out are removed. Answers with the scene.
 */
export const setSceneObjectsRequestSchema = z.strictObject({
  objects: z
    .array(sceneObjectInputSchema)
    .max(SCENE_MAX_OBJECTS, `A scene holds at most ${String(SCENE_MAX_OBJECTS)} props and puppets`)
    .refine(
      (objects) => new Set(objects.map((object) => object.id)).size === objects.length,
      'Each object needs its own id',
    ),
});
export type SetSceneObjectsRequest = z.infer<typeof setSceneObjectsRequestSchema>;

/**
 * `GET /api/campaigns/:campaignId/stage-records`: what the builder's tray offers. GM only.
 * `records` is every Prop, Item and NPC with an image for the stage, by name; `spots` is every
 * Spot, by name, with its backdrop if it has one.
 */
export const stageRecordsResponseSchema = z.object({
  records: z.array(stageRecordSchema),
  spots: z.array(sceneSpotSchema),
});
export type StageRecordsResponse = z.infer<typeof stageRecordsResponseSchema>;
