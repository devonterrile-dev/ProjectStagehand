/**
 * Live sessions (F3.3, governance §13): one play night, and the theater everyone in it sees.
 *
 * The server holds the stage and builds two views of it. The GM's has everything placed, with
 * names and which props are hidden and which puppets wait below. A player's has only what is in
 * sight (the backdrop, shown props, raised puppets) as an image and a place: no record id, no
 * name, no text (§7 "private by default"). A hidden prop or a lowered puppet is never sent to a
 * player's browser.
 */
import { z } from 'zod';

import { campaignRoleSchema } from './campaigns';
import { recordRefSchema } from './record-links';
import {
  propMountSchema,
  scaleSchema,
  sceneObjectKindSchema,
  stageImageSchema,
  unitSchema,
} from './scenes';
import { depthTickSchema } from './stage';

const timestamp = z.iso.datetime({ offset: true });

/** A running session: its number in the campaign (1, 2, 3…) and when it started. */
export const playSessionSchema = z.object({
  id: z.uuid(),
  number: z.int().positive(),
  startedAt: timestamp,
});
export type PlaySession = z.infer<typeof playSessionSchema>;

/**
 * `GET /api/campaigns/:campaignId/play-session` (any member): the running session, or null.
 * `POST` the same path (GM only; refused while archived) starts one, or answers the one already
 * running. `POST …/play-session/end` (GM only) ends it.
 */
export const playSessionResponseSchema = z.object({ session: playSessionSchema.nullable() });
export type PlaySessionResponse = z.infer<typeof playSessionResponseSchema>;

/** Where an object is and how it is drawn: the same for the GM and for players. */
const placement = {
  id: z.uuid(),
  kind: sceneObjectKindSchema,
  across: z.number(),
  up: z.number(),
  depthTick: depthTickSchema,
  scale: z.number(),
  flipped: z.boolean(),
  /** A prop's stand or string; null for a puppet, which is on a stick. */
  mount: propMountSchema.nullable(),
};

/** One object in sight, as a player's browser gets it: an image and a place, nothing else. */
export const playerStageObjectSchema = z.object({ ...placement, image: stageImageSchema });
export type PlayerStageObject = z.infer<typeof playerStageObjectSchema>;

/**
 * What a live object shows (F3.4): a record (a Prop or Item as a prop, an NPC as a puppet), with
 * whether players have it in their journal, or a PC, always a puppet. PCs have no reveal: a
 * player's own character is never a secret.
 */
export const stageSubjectSchema = z.discriminatedUnion('kind', [
  recordRefSchema.extend({ kind: z.literal('record'), revealed: z.boolean() }),
  z.object({ kind: z.literal('pc'), id: z.uuid(), name: z.string() }),
]);
export type StageSubject = z.infer<typeof stageSubjectSchema>;

/** One object on the live stage as the GM gets it, in sight or not. */
export const gmStageObjectSchema = z.object({
  ...placement,
  subject: stageSubjectSchema,
  /** Null: the record has lost its image for the stage, so nothing is drawn. */
  image: stageImageSchema.nullable(),
  /** A prop that is shown, or a puppet that is raised. False: players get nothing of it. */
  shown: z.boolean(),
});
export type GmStageObject = z.infer<typeof gmStageObjectSchema>;

/** What both views share. */
const stage = {
  session: playSessionSchema,
  /**
   * Goes up by one each time a scene is loaded. A browser that sees it change closes its
   * curtain, swaps the scene behind it, and opens again (§13 `scene:load`).
   */
  sceneLoad: z.int().nonnegative(),
  curtainOpen: z.boolean(),
  /** The loaded scene's Spot's image in use; null leaves the back wall bare. */
  backdrop: stageImageSchema.nullable(),
};

/** The theater as a player sees it. Objects are in list order: later ones are in front. */
export const playerStageSchema = z.object({
  role: z.literal('player'),
  ...stage,
  objects: z.array(playerStageObjectSchema),
});
export type PlayerStage = z.infer<typeof playerStageSchema>;

/** The theater as the GM runs it. */
export const gmStageSchema = z.object({
  role: z.literal('gm'),
  ...stage,
  /** The scene that was loaded, by its current name; null before any, or once it is deleted. */
  scene: z.object({ id: z.uuid(), name: z.string() }).nullable(),
  objects: z.array(gmStageObjectSchema),
});
export type GmStage = z.infer<typeof gmStageSchema>;

export const liveStageSchema = z.discriminatedUnion('role', [gmStageSchema, playerStageSchema]);
export type LiveStage = z.infer<typeof liveStageSchema>;

/** Someone connected to the session, as everyone in it sees them. */
export const presenceMemberSchema = z.object({
  userId: z.uuid(),
  displayName: z.string(),
  avatarUrl: z.url().nullable(),
  role: campaignRoleSchema,
  /** The player's PC, by name; null for the GM and for a player without one. */
  characterName: z.string().nullable(),
});
export type PresenceMember = z.infer<typeof presenceMemberSchema>;

/** Everyone connected: the GM first, then players by name. */
export const presenceSchema = z.array(presenceMemberSchema);
export type Presence = z.infer<typeof presenceSchema>;

/**
 * The live room (§13 "Real-time events"): one Socket.IO namespace. A browser connects with its
 * Stagehand session cookie, then asks to join a campaign's session.
 *
 * Browser to server, each answered through its acknowledgement:
 * - `join`: `joinRequestSchema` → `joinResultSchema`. Sent again after every reconnect, so a
 *   reconnect always gets the stage as it is now.
 * - `loadScene`: `loadSceneRequestSchema` → `actionResultSchema`. GM only. With the curtain
 *   open, browsers change scene behind it; with it closed, it stays closed (F3.4).
 * - `openCurtain`, `closeCurtain`: no payload → `actionResultSchema`. GM only.
 * - The control desk (F3.4), each → `actionResultSchema`, GM only: `addObject`
 *   (`addObjectRequestSchema`), `moveObject` (`moveObjectRequestSchema`), and `removeObject`,
 *   `showProp`, `hideProp`, `raisePuppet`, `lowerPuppet` (`objectRequestSchema`).
 *
 * Whatever comes into sight while the curtain is open, or is in sight when it opens, is revealed
 * to players (§7): only at that moment, so a record the GM un-reveals stays hidden.
 *
 * Server to browser:
 * - `stage`: the whole stage for that browser's role (`liveStageSchema`), after every change.
 * - `presence`: who is connected (`presenceSchema`), after every change.
 * - `started`: a session began; sent to members who were waiting, who then `join`.
 * - `ended`: the GM ended the session.
 */
export const PLAY_SOCKET = {
  /** Socket.IO's default path, the one Discord's proxy was tried with (D-48). */
  path: '/socket.io',
  namespace: '/play',
  join: 'session:join',
  loadScene: 'scene:load',
  openCurtain: 'scene:curtain.open',
  closeCurtain: 'scene:curtain.close',
  addObject: 'scene:object.add',
  moveObject: 'scene:object.move',
  removeObject: 'scene:object.remove',
  showProp: 'scene:object.show',
  hideProp: 'scene:object.hide',
  raisePuppet: 'puppet:raise',
  lowerPuppet: 'puppet:lower',
  stage: 'stage',
  presence: 'presence',
  started: 'session:started',
  ended: 'session:ended',
} as const;

export const joinRequestSchema = z.strictObject({ campaignId: z.uuid() });
export type JoinRequest = z.infer<typeof joinRequestSchema>;

/**
 * What a `join` is answered with.
 * - `joined`: in the room, with the stage and who is here.
 * - `no-session`: nothing is running; the browser waits and is told when one starts.
 * - `full`: the session already has its 6 players (§3); the browser may ask again.
 * - `not-found`: not a member of that campaign, or no such campaign.
 */
export const joinResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('joined'), stage: liveStageSchema, presence: presenceSchema }),
  z.object({ status: z.literal('no-session') }),
  z.object({ status: z.literal('full') }),
  z.object({ status: z.literal('not-found') }),
]);
export type JoinResult = z.infer<typeof joinResultSchema>;

export const loadSceneRequestSchema = z.strictObject({ sceneId: z.uuid() });
export type LoadSceneRequest = z.infer<typeof loadSceneRequestSchema>;

/**
 * Where a new live object goes when nothing is said: in the middle, halfway back, a prop on the
 * bottom edge and a puppet rising a little above it (as in the builder).
 */
export const LIVE_OBJECT_START = { across: 0.5, depthTick: 5, propUp: 0, puppetUp: 0.1 } as const;

/**
 * Puts a record (a Prop or Item as a prop, an NPC as a puppet) or a PC (a puppet) on the live
 * stage. The browser makes the id. It arrives out of sight, a prop hidden and a puppet waiting
 * below, so the GM can place it before players see it; `shown` brings a prop in at once. Never
 * saved to the scene.
 */
export const addObjectRequestSchema = z
  .strictObject({
    id: z.uuid(),
    recordId: z.uuid().optional(),
    characterId: z.uuid().optional(),
    across: unitSchema.optional(),
    up: unitSchema.optional(),
    depthTick: depthTickSchema.optional(),
    /** Props only. */
    shown: z.boolean().optional(),
    /** Props only; a prop is on a stand unless it hangs. */
    mount: propMountSchema.optional(),
  })
  .refine(
    (request) => (request.recordId === undefined) !== (request.characterId === undefined),
    'Choose a record or a PC',
  );
export type AddObjectRequest = z.infer<typeof addObjectRequestSchema>;

/** Changes where a live object is and how it is drawn; any subset. `mount` is for props. */
export const moveObjectRequestSchema = z
  .strictObject({
    id: z.uuid(),
    across: unitSchema.optional(),
    up: unitSchema.optional(),
    depthTick: depthTickSchema.optional(),
    scale: scaleSchema.optional(),
    flipped: z.boolean().optional(),
    mount: propMountSchema.optional(),
  })
  .refine((request) => Object.keys(request).length > 1, 'Nothing to change');
export type MoveObjectRequest = z.infer<typeof moveObjectRequestSchema>;
export type ObjectChanges = Omit<MoveObjectRequest, 'id'>;

/** Names one live object: to remove it, show or hide a prop, raise or lower a puppet. */
export const objectRequestSchema = z.strictObject({ id: z.uuid() });
export type ObjectRequest = z.infer<typeof objectRequestSchema>;

/** What a GM's action is answered with; `message` says why it was refused. */
export const actionResultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true) }),
  z.object({ ok: z.literal(false), message: z.string() }),
]);
export type ActionResult = z.infer<typeof actionResultSchema>;
