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
import { partyMemberSchema, rollStage } from './rolls';
import {
  propMountSchema,
  scaleSchema,
  sceneObjectKindSchema,
  stageImageSchema,
  travelModeSchema,
  unitSchema,
} from './scenes';
import {
  battleSideSchema,
  battleSizeSchema,
  depthTickSchema,
  paintColorSchema,
  paintSizeSchema,
  paintToolSchema,
  PAINT_CHUNK_POINTS,
  squareSchema,
  strokePointsSchema,
} from './stage';

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
  /**
   * In a transition scene (F5.4), the travel distance at which it began to pass by: a prop
   * shown or a stationary NPC raised. From then on its place across comes from the travel
   * clock, not from `across`. Null when it isn't passing.
   */
  passFrom: z.number().nullable(),
};

/**
 * One object in sight, as a player's browser gets it: an image and a place, and (F3.5) the
 * record it shows when players have that record, so they can inspect it. Null for a PC, and for
 * a record the GM has un-revealed.
 */
export const playerStageObjectSchema = z.object({
  ...placement,
  image: stageImageSchema,
  recordId: z.uuid().nullable(),
  /**
   * The PC a puppet is (F3.7), so a player finds their own puppet to emote and everyone sees
   * who is talking; null for anything else. Which PC is whose is no secret.
   */
  characterId: z.uuid().nullable(),
});
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
  /** An NPC puppet's travel mode (F5.4); null for a prop, and for a PC, which always walks. */
  travelMode: travelModeSchema.nullable(),
});
export type GmStageObject = z.infer<typeof gmStageObjectSchema>;

/**
 * A transition scene's travel (F5.4): playing or paused, and how far it has gone, in opening
 * widths, when the stage was sent. While playing, a browser counts on from when it arrived.
 */
export const stageTravelSchema = z.object({
  playing: z.boolean(),
  distance: z.number().nonnegative(),
});
export type StageTravel = z.infer<typeof stageTravelSchema>;

/**
 * A battle token as the GM gets it (F5.5): the live object (a PC or NPC puppet) it stands for,
 * by its id, so its name and picture come from that object; its side; and its square, or null
 * while it waits beside the mat.
 */
export const gmBattleTokenSchema = z.object({
  id: z.uuid(),
  side: battleSideSchema,
  square: squareSchema.nullable(),
});
export type GmBattleToken = z.infer<typeof gmBattleTokenSchema>;

/**
 * A battle token as a player gets it: only tokens on the mat, each with its own picture, since a
 * puppet waiting below is not among a player's objects (19.31). `characterId` names a PC's.
 */
export const playerBattleTokenSchema = z.object({
  id: z.uuid(),
  side: battleSideSchema,
  image: stageImageSchema,
  characterId: z.uuid().nullable(),
  square: squareSchema,
});
export type PlayerBattleToken = z.infer<typeof playerBattleTokenSchema>;

/**
 * A stroke of paint on the battle mat (F5.6): painted in a color, or rubbed out (`erase`, no
 * color), at a brush size, through its points (`strokePointsSchema`). The paint is no secret:
 * both views get every stroke, in the order drawn.
 */
export const strokeSchema = z.object({
  id: z.uuid(),
  tool: paintToolSchema,
  color: paintColorSchema.nullable(),
  size: paintSizeSchema,
  points: strokePointsSchema,
});
export type Stroke = z.infer<typeof strokeSchema>;

export const gmBattleSchema = z.object({
  size: battleSizeSchema,
  tokens: z.array(gmBattleTokenSchema),
  strokes: z.array(strokeSchema),
});
export type GmBattle = z.infer<typeof gmBattleSchema>;

export const playerBattleSchema = z.object({
  size: battleSizeSchema,
  tokens: z.array(playerBattleTokenSchema),
  strokes: z.array(strokeSchema),
});
export type PlayerBattle = z.infer<typeof playerBattleSchema>;

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
  /** The loaded scene's travel (F5.4); null unless it is a transition scene. */
  travel: stageTravelSchema.nullable(),
  /** Fear, the calls waiting and the last roll (F3.6); see `rolls.ts`. */
  ...rollStage,
};

/** The theater as a player sees it. Objects are in list order: later ones are in front. */
export const playerStageSchema = z.object({
  role: z.literal('player'),
  ...stage,
  objects: z.array(playerStageObjectSchema),
  /** The battle on the table (F5.5); null when there is none. */
  battle: playerBattleSchema.nullable(),
});
export type PlayerStage = z.infer<typeof playerStageSchema>;

/** The theater as the GM runs it. */
export const gmStageSchema = z.object({
  role: z.literal('gm'),
  ...stage,
  /** The scene that was loaded, by its current name; null before any, or once it is deleted. */
  scene: z.object({ id: z.uuid(), name: z.string() }).nullable(),
  objects: z.array(gmStageObjectSchema),
  /** Every PC with a player, with its Hope (F3.6): what the desk calls rolls for. */
  party: z.array(partyMemberSchema),
  /** The battle on the table (F5.5), every token included; null when there is none. */
  battle: gmBattleSchema.nullable(),
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
  /** The player's PC (F3.7): their puppet is the one that talks. */
  characterId: z.uuid().nullable(),
  /** Talking right now (F3.7, `motion.ts`). */
  speaking: z.boolean(),
  /**
   * The live object (an NPC puppet) whose voice this person is right now (F3.8): while they
   * talk, that puppet talks instead of them. Only ever the GM's; null for everyone else.
   */
  voicing: z.uuid().nullable(),
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
 * - Rolls, Hope and Fear (F3.6, `rolls.ts`), each → `actionResultSchema`. GM only: `callRoll`
 *   (`rollCallRequestSchema`), `cancelRoll` (`cancelRollRequestSchema`), `revealRoll`
 *   (`revealRollRequestSchema`), `spendFear` (`spendFearRequestSchema`), `setFear`
 *   (`setFearRequestSchema`), `setHope` (`setHopeRequestSchema`). A player, for their own PC
 *   only: `makeRoll` (`makeRollRequestSchema`).
 * - `emote` (F3.7, `motion.ts`): `emoteRequestSchema` → `actionResultSchema`. The GM on any
 *   raised puppet; a player on their own PC's. At most one a connection every 800 ms.
 * - `freeRoll` (F4.2, `rolls.ts`): `freeRollRequestSchema` → `actionResultSchema`. Anyone at
 *   the table; only the GM may roll privately. At most one a connection every second.
 * - `playTravel`, `pauseTravel` (F5.4): no payload → `actionResultSchema`. GM only, while a
 *   transition scene is loaded: its travel plays, or stops where it is.
 * - `takeOverNpc` (F3.8): `objectRequestSchema` → `actionResultSchema`. GM only: a raised NPC
 *   puppet's voice becomes the GM's (presence `voicing`). `releaseNpc`: `releaseRequestSchema`
 *   → `actionResultSchema`. Lowering, removing or loading a scene over that NPC releases it.
 * - Battle mode (F5.5), each → `actionResultSchema`, GM only: `startBattle`
 *   (`startBattleRequestSchema`) closes the curtain, pauses any travel and lays out a mat with a
 *   token beside it for every puppet; `endBattle` (`endBattleRequestSchema`) rolls it up and
 *   leaves the curtain closed; `moveToken` (`moveTokenRequestSchema`) puts a token on a square,
 *   or back beside the mat with a null square. Placing an NPC's token reveals its record. While a
 *   battle is on, `loadScene` and `playTravel` are refused.
 * - Painting the mat (F5.6), each → `actionResultSchema`, GM only, while a battle is on:
 *   `paintStroke` (`paintStrokeRequestSchema`) starts a stroke or adds points to it, by its id;
 *   `undoStroke` and `clearPaint` (`{}`) take back the last stroke, or every one.
 *
 * Browser to server, never answered:
 * - `speaking` (F3.7): `speakingRequestSchema`, whenever the sender starts or stops talking.
 *   Everyone gets it as presence.
 *
 * Whatever comes into sight while the curtain is open, or is in sight when it opens, is revealed
 * to players (§7): only at that moment, so a record the GM un-reveals stays hidden.
 *
 * Server to browser:
 * - `stage`: the whole stage for that browser's role (`liveStageSchema`), after every change.
 * - `presence`: who is connected (`presenceSchema`), after every change.
 * - `started`: a session began; sent to members who were waiting, who then `join`.
 * - `ended`: the GM ended the session.
 * - `journalChanged`: something in the journal changed (a reveal, a note, an entry; F3.5): read
 *   it again.
 * - `sheetChanged`: a PC's sheet changed (`sheetChangedSchema`, F3.6); its player reads it again.
 * - `logChanged`: to the GM only, the session's log grew (F3.6); the desk reads it again.
 * - `emote`: an emote plays (`emotePlayedSchema`, F3.7); sent once, never stored.
 * - `freeRoll`: a free roll landed (`freeRollSchema`, F4.2); sent once, logged. A private one
 *   goes to the GM only.
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
  journalChanged: 'journal:changed',
  callRoll: 'roll:call',
  cancelRoll: 'roll:cancel',
  revealRoll: 'roll:reveal',
  makeRoll: 'roll:make',
  spendFear: 'fear:spend',
  setFear: 'fear:adjust',
  setHope: 'hope:adjust',
  setRest: 'rest:set',
  freeRoll: 'roll:free',
  sheetChanged: 'sheet:changed',
  logChanged: 'log:changed',
  emote: 'emote',
  speaking: 'speaking',
  playTravel: 'transition:play',
  pauseTravel: 'transition:pause',
  takeOverNpc: 'npc:takeover',
  releaseNpc: 'npc:release',
  startBattle: 'battle:start',
  endBattle: 'battle:end',
  moveToken: 'battle:token.move',
  paintStroke: 'battle:paint',
  undoStroke: 'battle:paint.undo',
  clearPaint: 'battle:paint.clear',
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

/**
 * Changes where a live object is and how it is drawn; any subset. `mount` is for props, and
 * `travelMode` for an NPC puppet waiting below (F5.4). A passing object's `across` comes from
 * the travel clock, so it can't be set.
 */
export const moveObjectRequestSchema = z
  .strictObject({
    id: z.uuid(),
    across: unitSchema.optional(),
    up: unitSchema.optional(),
    depthTick: depthTickSchema.optional(),
    scale: scaleSchema.optional(),
    flipped: z.boolean().optional(),
    mount: propMountSchema.optional(),
    travelMode: travelModeSchema.optional(),
  })
  .refine((request) => Object.keys(request).length > 1, 'Nothing to change');
export type MoveObjectRequest = z.infer<typeof moveObjectRequestSchema>;
export type ObjectChanges = Omit<MoveObjectRequest, 'id'>;

/** Names one live object: to remove it, show or hide a prop, raise or lower a puppet. */
export const objectRequestSchema = z.strictObject({ id: z.uuid() });
export type ObjectRequest = z.infer<typeof objectRequestSchema>;

/** Gives the GM's voice back to the GM (F3.8). */
export const releaseRequestSchema = z.strictObject({});
export type ReleaseRequest = z.infer<typeof releaseRequestSchema>;

/** Lays a mat of this size out on the table (F5.5). */
export const startBattleRequestSchema = z.strictObject({ size: battleSizeSchema });
export type StartBattleRequest = z.infer<typeof startBattleRequestSchema>;

/** Rolls the mat up (F5.5). */
export const endBattleRequestSchema = z.strictObject({});
export type EndBattleRequest = z.infer<typeof endBattleRequestSchema>;

/** Puts a token (by its live object's id) on a square, or beside the mat with null (F5.5). */
export const moveTokenRequestSchema = z.strictObject({
  id: z.uuid(),
  square: squareSchema.nullable(),
});
export type MoveTokenRequest = z.infer<typeof moveTokenRequestSchema>;

/**
 * Paints on the battle mat (F5.6): the first message with a stroke's id starts it, and later ones
 * add their points to it, in the same tool, color and size. An erase has no color; a paint
 * stroke has one. At most `PAINT_CHUNK_POINTS` points a message.
 */
export const paintStrokeRequestSchema = z
  .strictObject({
    id: z.uuid(),
    tool: paintToolSchema,
    color: paintColorSchema.optional(),
    size: paintSizeSchema,
    points: strokePointsSchema.refine(
      (points) => points.length >= 2 && points.length <= 2 * PAINT_CHUNK_POINTS,
      'Between 1 and 60 points',
    ),
  })
  .refine(
    (request) => (request.tool === 'paint') === (request.color !== undefined),
    'Paint has a color; an erase has none',
  );
export type PaintStrokeRequest = z.infer<typeof paintStrokeRequestSchema>;

/** Takes back the last stroke, or clears every one (F5.6). */
export const paintRequestSchema = z.strictObject({});

/** What an action is answered with; `message` says why it was refused. */
export const actionResultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true) }),
  z.object({ ok: z.literal(false), message: z.string() }),
]);
export type ActionResult = z.infer<typeof actionResultSchema>;
