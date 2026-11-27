/**
 * Live sessions (F3.3, F3.4, governance §13, D-50, D-52). Part of the campaign data-access
 * layer: every query is scoped to `scope.campaignId`. With `rolls.ts` (F3.6), the only code that
 * queries `play_sessions`, `play_session_objects`, `play_roll_calls` and `session_events`.
 *
 * A campaign has at most one running session. Its stage is a copy of the scene that was loaded
 * (`loadSceneLive`), changed from then on by the control desk (`addLiveObject` and the rest),
 * and read back as two views (`stagesOf`): everything for the GM, and for players only what is
 * in sight, built from its own short list of fields and never by trimming the GM's. Callers
 * check `assertGm` for everything that changes a session.
 *
 * Reveals (§7 rule 2): a record is revealed when it comes into sight while the curtain is open,
 * or is in sight when the curtain opens. Only that moment reveals it, so a record the GM
 * un-reveals while it is on stage stays hidden until it comes into sight again.
 *
 * Travel (F5.4, D-75): a transition scene loads paused; while it plays, the session's travel
 * clock runs (`travelDistance` in the shared package). A prop shown, or a stationary NPC raised,
 * passes by from the distance it came into sight at (`pass_from`), and its pass is over
 * `PASS_SPAN` later. A finished pass counts as hidden or lowered the moment it ends: the views
 * treat it so at once, and `settlePasses` (the live room's timer) or the next change writes it.
 * Functions that read the clock take `now` (milliseconds) so tests can drive it.
 */
import {
  gmStageSchema,
  LIVE_OBJECT_START,
  PASS_SPAN,
  passOver,
  playerStageSchema,
  playSessionSchema,
  rulesetFor,
  sceneObjectKindFor,
  STAGE_MAX_OBJECTS,
  type AddObjectRequest,
  type GmStage,
  type MoveObjectRequest,
  type PlayerStage,
  type PlaySession,
  type SceneObjectKind,
  type StageSubject,
  travelDistance,
  type TravelClock,
} from '@stagehand/shared';
import { and, asc, count, eq, inArray, isNotNull, isNull, lte, max, sql } from 'drizzle-orm';

import type { Database } from '../db/client';
import {
  campaigns,
  characters,
  playRollCalls,
  playSessionObjects,
  playSessions,
  records,
  scenes,
  sessionEvents,
} from '../db/schema';
import { httpError } from '../http/errors';

import type { DbOrTx } from './members';
import { sceneForStage } from './scenes';
import type { CampaignScope } from './scope';
import { isRevealedRecordImage } from './journal';
import { rollStageOf } from './rolls';
import {
  lockRunning,
  logEvent,
  NO_SESSION,
  running,
  type SessionRow,
  type Tx,
} from './session-core';
import { stageImagesOf } from './visuals';

export { NO_SESSION } from './session-core';

type ObjectRow = typeof playSessionObjects.$inferSelect;

const NOT_ON_STAGE = 'That is no longer on the stage';
const NOT_TRAVELLING = 'Load a transition scene first';

/** A session's travel clock (F5.4). */
function clockOf(session: SessionRow): TravelClock {
  return { distance: session.travelDistance, since: session.travelSince?.getTime() ?? null };
}

/**
 * Writes every pass that is over by `now` (F5.4): back to hidden, or lowered. True when one was.
 * Run first by every change that reads what is in sight, so it never sees a finished pass.
 */
async function settleIn(tx: Tx, session: SessionRow, now: number): Promise<boolean> {
  if (!session.transition) return false;
  const distance = travelDistance(clockOf(session), now);
  const settled = await tx
    .update(playSessionObjects)
    .set({ shown: false, passFrom: null })
    .where(
      and(
        eq(playSessionObjects.playSessionId, session.id),
        isNotNull(playSessionObjects.passFrom),
        lte(playSessionObjects.passFrom, distance - PASS_SPAN),
      ),
    )
    .returning({ id: playSessionObjects.id });
  return settled.length > 0;
}

/**
 * Whether a live object passes by when it comes into sight (F5.4): in a transition scene, a prop,
 * or an NPC puppet set stationary. PCs and walking NPCs travel with the party.
 */
function passes(session: SessionRow, object: ObjectRow): boolean {
  if (!session.transition) return false;
  return object.kind === 'prop' || object.travelMode === 'stationary';
}

function toPlaySession(row: SessionRow): PlaySession {
  return playSessionSchema.parse({
    id: row.id,
    number: row.number,
    startedAt: row.startedAt.toISOString(),
  });
}

/** One object of the running session's stage. 404 when it isn't there. */
async function liveObject(tx: Tx, session: SessionRow, id: string): Promise<ObjectRow> {
  const [object] = await tx
    .select()
    .from(playSessionObjects)
    .where(and(eq(playSessionObjects.playSessionId, session.id), eq(playSessionObjects.id, id)));
  if (object === undefined) throw httpError(404, NOT_ON_STAGE);
  return object;
}

/**
 * Reveals every record among `recordIds` that players don't have yet, and logs each as revealed
 * by the stage (no actor). PCs' puppets pass null and are skipped.
 */
async function revealInSight(
  tx: Tx,
  scope: CampaignScope,
  session: SessionRow,
  recordIds: readonly (string | null)[],
): Promise<void> {
  const ids = [...new Set(recordIds.filter((id): id is string => id !== null))];
  if (ids.length === 0) return;
  const revealed = await tx
    .update(records)
    // A reveal is about who may see the record, not a change to it: `updated_at` stays.
    .set({ revealedAt: new Date(), updatedAt: sql`${records.updatedAt}` })
    .where(
      and(
        eq(records.campaignId, scope.campaignId),
        inArray(records.id, ids),
        isNull(records.revealedAt),
      ),
    )
    .returning({ id: records.id });
  if (revealed.length === 0) return;
  await tx.insert(sessionEvents).values(
    revealed.map(({ id }) => ({
      playSessionId: session.id,
      campaignId: scope.campaignId,
      kind: 'reveal' as const,
      actorUserId: null,
      recordId: id,
    })),
  );
}

/** The records of everything in sight on the session's stage. */
async function recordsInSight(tx: Tx, session: SessionRow): Promise<(string | null)[]> {
  const shown = await tx
    .select({ recordId: playSessionObjects.recordId })
    .from(playSessionObjects)
    .where(
      and(eq(playSessionObjects.playSessionId, session.id), eq(playSessionObjects.shown, true)),
    );
  return shown.map((row) => row.recordId);
}

/** The campaign's running session, or null. */
export async function getActiveSession(
  db: DbOrTx,
  scope: CampaignScope,
): Promise<PlaySession | null> {
  const [row] = await db.select().from(playSessions).where(running(scope));
  return row === undefined ? null : toPlaySession(row);
}

/**
 * Starts a session (§13): the next number, an empty theater behind a closed curtain, and Fear at
 * the ruleset's starting value. If one is already running it is answered instead, with
 * `started: false`, so two clicks on Start agree on one session.
 */
export async function startSession(
  db: Database,
  scope: CampaignScope,
): Promise<{ session: PlaySession; started: boolean }> {
  return db.transaction(async (tx) => {
    // Held until the transaction ends: starts in one campaign run one at a time.
    await tx
      .select({ id: campaigns.id })
      .from(campaigns)
      .where(eq(campaigns.id, scope.campaignId))
      .for('update');

    const [already] = await tx.select().from(playSessions).where(running(scope));
    if (already !== undefined) return { session: toPlaySession(already), started: false };

    const [last] = await tx
      .select({ number: max(playSessions.number) })
      .from(playSessions)
      .where(eq(playSessions.campaignId, scope.campaignId));
    const [row] = await tx
      .insert(playSessions)
      .values({
        campaignId: scope.campaignId,
        number: (last?.number ?? 0) + 1,
        fear: rulesetFor(scope.campaign.rulesetVersion).fearStart,
      })
      .returning();
    if (row === undefined) throw new Error('play session insert returned no row');
    return { session: toPlaySession(row), started: true };
  });
}

/** Ends the running session and clears its stage and calls; its log stays. 404 when none is running. */
export async function endSession(db: Database, scope: CampaignScope): Promise<void> {
  await db.transaction(async (tx) => {
    const [ended] = await tx
      .update(playSessions)
      .set({ endedAt: new Date() })
      .where(running(scope))
      .returning({ id: playSessions.id });
    if (ended === undefined) throw httpError(404, NO_SESSION);
    await tx.delete(playSessionObjects).where(eq(playSessionObjects.playSessionId, ended.id));
    // Rolls nobody made go with the stage (F3.6); the rolls made stay in the log.
    await tx.delete(playRollCalls).where(eq(playRollCalls.playSessionId, ended.id));
  });
}

/**
 * Loads a scene onto the live stage (§13 `scene:load`): the stage becomes a copy of the scene's
 * Spot and objects, as saved (hidden props hidden, puppets lowered). The curtain stays as it
 * was: open, browsers close it, swap and open again, and the shown props are revealed; closed,
 * it stays closed so the GM can arrange the stage first (F3.4). A transition scene (F5.4) loads
 * paused at the start of its travel, with every prop hidden: they pass by once shown. 409 when no
 * session is running, 404 for a scene that isn't in this campaign.
 */
export async function loadSceneLive(
  db: Database,
  scope: CampaignScope,
  sceneId: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    const session = await lockRunning(tx, scope);

    const scene = await sceneForStage(tx, scope, sceneId);
    if (scene === null) throw httpError(404, 'Scene not found');

    await tx.delete(playSessionObjects).where(eq(playSessionObjects.playSessionId, session.id));
    // A Spot made a transition Spot after the scene was built may have shown props saved.
    const objects = scene.transition
      ? scene.objects.map((object) => ({ ...object, shown: false }))
      : scene.objects;
    if (objects.length > 0) {
      await tx.insert(playSessionObjects).values(
        objects.map((object) => ({
          playSessionId: session.id,
          id: object.id,
          campaignId: scope.campaignId,
          kind: object.kind,
          recordId: object.recordId,
          across: object.across,
          up: object.up,
          depthTick: object.depthTick,
          scale: object.scale,
          flipped: object.flipped,
          shown: object.shown,
          mount: object.mount,
          travelMode: object.travelMode,
          position: object.position,
        })),
      );
    }
    await tx
      .update(playSessions)
      .set({
        sceneId,
        spotId: scene.spotId,
        sceneLoads: sql`${playSessions.sceneLoads} + 1`,
        transition: scene.transition,
        travelDistance: 0,
        travelSince: null,
      })
      .where(eq(playSessions.id, session.id));
    await logEvent(tx, scope, session, 'scene_load', {
      actorUserId: scope.userId,
      data: { sceneId, name: scene.name },
    });
    if (session.curtainOpen) {
      await revealInSight(
        tx,
        scope,
        session,
        objects.filter((object) => object.shown).map((object) => object.recordId),
      );
    }
  });
}

/**
 * Plays or pauses the loaded transition scene's travel for everyone (F5.4, §13
 * `transition:play` and `pause`). Pausing stops everything where it is: the distance so far is
 * kept, and what has finished passing goes back to hidden. Nothing changes when it already
 * is so. 409 when no session is running, or the loaded scene isn't a transition scene.
 */
export async function setTravelPlaying(
  db: Database,
  scope: CampaignScope,
  playing: boolean,
  now = Date.now(),
): Promise<void> {
  await db.transaction(async (tx) => {
    const session = await lockRunning(tx, scope);
    if (!session.transition) throw httpError(409, NOT_TRAVELLING);
    if ((session.travelSince !== null) === playing) return;
    await settleIn(tx, session, now);
    await tx
      .update(playSessions)
      .set(
        playing
          ? { travelSince: new Date(now) }
          : { travelDistance: travelDistance(clockOf(session), now), travelSince: null },
      )
      .where(eq(playSessions.id, session.id));
  });
}

/**
 * Writes the passes that are over (F5.4): what has passed by goes back to hidden, or is lowered.
 * The live room calls it when the next pass ends. True when anything changed; false with no
 * session running.
 */
export async function settlePasses(
  db: Database,
  scope: CampaignScope,
  now = Date.now(),
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [session] = await tx.select().from(playSessions).where(running(scope)).for('update');
    if (session === undefined) return false;
    return settleIn(tx, session, now);
  });
}

/**
 * Opens or closes the front curtain for everyone. Opening it reveals what is in sight. 409 when
 * no session is running.
 */
export async function setCurtain(
  db: Database,
  scope: CampaignScope,
  open: boolean,
  now = Date.now(),
): Promise<void> {
  await db.transaction(async (tx) => {
    const session = await lockRunning(tx, scope);
    if (session.curtainOpen === open) return;
    await settleIn(tx, session, now);
    await tx.update(playSessions).set({ curtainOpen: open }).where(eq(playSessions.id, session.id));
    if (open) await revealInSight(tx, scope, session, await recordsInSight(tx, session));
  });
}

/** What can go on the stage, as found: its kind and how it is named in a refusal. */
interface Subject {
  kind: SceneObjectKind;
  name: string;
  recordId: string | null;
  characterId: string | null;
}

async function subjectOf(tx: Tx, scope: CampaignScope, request: AddObjectRequest) {
  let subject: Subject;
  let assetId: string | null;
  if (request.recordId !== undefined) {
    const [record] = await tx
      .select({ type: records.type, name: records.name, visualAssetId: records.visualAssetId })
      .from(records)
      .where(and(eq(records.id, request.recordId), eq(records.campaignId, scope.campaignId)));
    if (record === undefined) throw httpError(404, 'Record not found');
    const kind = sceneObjectKindFor(record.type);
    if (kind === null) throw httpError(400, 'Only Props, Items and NPCs can go on the stage');
    subject = { kind, name: record.name, recordId: request.recordId, characterId: null };
    assetId = record.visualAssetId;
  } else if (request.characterId !== undefined) {
    const [character] = await tx
      .select({ name: characters.name, visualAssetId: characters.visualAssetId })
      .from(characters)
      .where(
        and(eq(characters.id, request.characterId), eq(characters.campaignId, scope.campaignId)),
      );
    if (character === undefined) throw httpError(404, 'PC not found');
    subject = {
      kind: 'puppet',
      name: character.name,
      recordId: null,
      characterId: request.characterId,
    };
    assetId = character.visualAssetId;
  } else {
    throw httpError(400, 'Choose a record or a PC');
  }
  const images = await stageImagesOf(tx, scope, assetId === null ? [] : [assetId]);
  if (images.size === 0) throw httpError(409, `${subject.name} has no image for the stage yet`);
  return subject;
}

/**
 * Puts a record or a PC on the live stage (§13 `scene:object.add`), out of sight unless a prop
 * is asked to be shown: a prop hidden, a puppet waiting below. The saved scene is untouched.
 * At most `STAGE_MAX_OBJECTS` objects; an NPC or a PC is on the stage once.
 */
export async function addLiveObject(
  db: Database,
  scope: CampaignScope,
  request: AddObjectRequest,
  now = Date.now(),
): Promise<void> {
  await db.transaction(async (tx) => {
    const session = await lockRunning(tx, scope);
    const onStage = eq(playSessionObjects.playSessionId, session.id);

    const [taken] = await tx
      .select({ id: playSessionObjects.id })
      .from(playSessionObjects)
      .where(and(onStage, eq(playSessionObjects.id, request.id)));
    if (taken !== undefined) throw httpError(409, 'That is already on the stage');

    const [placed] = await tx
      .select({ count: count(), last: max(playSessionObjects.position) })
      .from(playSessionObjects)
      .where(onStage);
    if ((placed?.count ?? 0) >= STAGE_MAX_OBJECTS) {
      throw httpError(
        409,
        `The stage holds at most ${String(STAGE_MAX_OBJECTS)} props and puppets`,
      );
    }

    const subject = await subjectOf(tx, scope, request);
    const isProp = subject.kind === 'prop';
    if (!isProp && (request.shown !== undefined || request.mount !== undefined)) {
      throw httpError(400, 'A puppet is raised, not shown, and is always on a stick');
    }
    if (!isProp) {
      const [already] = await tx
        .select({ id: playSessionObjects.id })
        .from(playSessionObjects)
        .where(
          and(
            onStage,
            subject.recordId !== null
              ? eq(playSessionObjects.recordId, subject.recordId)
              : subject.characterId !== null
                ? eq(playSessionObjects.characterId, subject.characterId)
                : undefined,
          ),
        );
      if (already !== undefined) throw httpError(409, `${subject.name} is already on the stage`);
    }

    const shown = isProp && request.shown === true;
    await tx.insert(playSessionObjects).values({
      playSessionId: session.id,
      id: request.id,
      campaignId: scope.campaignId,
      kind: subject.kind,
      recordId: subject.recordId,
      characterId: subject.characterId,
      across: request.across ?? LIVE_OBJECT_START.across,
      up: request.up ?? (isProp ? LIVE_OBJECT_START.propUp : LIVE_OBJECT_START.puppetUp),
      depthTick: request.depthTick ?? LIVE_OBJECT_START.depthTick,
      shown,
      mount: isProp ? (request.mount ?? 'stand') : null,
      // An NPC added live walks with the party (F5.4); the GM can make it stationary below.
      travelMode: !isProp && subject.recordId !== null ? 'walking' : null,
      // Shown at once in a transition scene, a prop passes by from here.
      passFrom: shown && session.transition ? travelDistance(clockOf(session), now) : null,
      position: (placed?.last ?? -1) + 1,
    });
    if (shown && session.curtainOpen) {
      await revealInSight(tx, scope, session, [subject.recordId]);
    }
  });
}

/**
 * Moves a live object or changes how it is drawn (§13 `scene:object.move`). A passing object's
 * place across comes from the travel clock (F5.4), so it can't be set; an NPC puppet's travel
 * mode is set while it waits below.
 */
export async function moveLiveObject(
  db: Database,
  scope: CampaignScope,
  request: MoveObjectRequest,
  now = Date.now(),
): Promise<void> {
  await db.transaction(async (tx) => {
    const session = await lockRunning(tx, scope);
    await settleIn(tx, session, now);
    const object = await liveObject(tx, session, request.id);
    if (request.mount !== undefined && object.kind !== 'prop') {
      throw httpError(400, 'A puppet is always on a stick');
    }
    if (request.across !== undefined && object.passFrom !== null) {
      throw httpError(409, 'It is passing by: its place across follows the travel');
    }
    if (request.travelMode !== undefined) {
      if (object.kind !== 'puppet' || object.recordId === null) {
        throw httpError(400, 'Only NPC puppets walk or stay where they are');
      }
      if (object.shown) throw httpError(409, 'Lower it first, then set how it travels');
    }
    const { id, ...changes } = request;
    await tx
      .update(playSessionObjects)
      .set(changes)
      .where(and(eq(playSessionObjects.playSessionId, session.id), eq(playSessionObjects.id, id)));
  });
}

/** Takes an object off the live stage (§13 `scene:object.remove`); the saved scene keeps it. */
export async function removeLiveObject(
  db: Database,
  scope: CampaignScope,
  id: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    const session = await lockRunning(tx, scope);
    const removed = await tx
      .delete(playSessionObjects)
      .where(and(eq(playSessionObjects.playSessionId, session.id), eq(playSessionObjects.id, id)))
      .returning({ id: playSessionObjects.id });
    if (removed.length === 0) throw httpError(404, NOT_ON_STAGE);
  });
}

/**
 * Shows or hides a prop, or raises or lowers a puppet (§13 `scene:object.show`/`hide`,
 * `puppet:raise`/`lower`): `kind` says which the browser meant, and the object must be one.
 * Coming into sight with the curtain open reveals its record. In a transition scene (F5.4) a
 * prop shown, or a stationary NPC raised, starts to pass by; hiding or lowering ends its pass.
 */
export async function setLiveObjectShown(
  db: Database,
  scope: CampaignScope,
  id: string,
  kind: SceneObjectKind,
  shown: boolean,
  now = Date.now(),
): Promise<void> {
  await db.transaction(async (tx) => {
    const session = await lockRunning(tx, scope);
    await settleIn(tx, session, now);
    const object = await liveObject(tx, session, id);
    if (object.kind !== kind) {
      throw httpError(400, kind === 'prop' ? 'That is not a prop' : 'That is not a puppet');
    }
    if (object.shown === shown) return;
    const passFrom =
      shown && passes(session, object) ? travelDistance(clockOf(session), now) : null;
    await tx
      .update(playSessionObjects)
      .set({ shown, passFrom })
      .where(and(eq(playSessionObjects.playSessionId, session.id), eq(playSessionObjects.id, id)));
    if (shown && session.curtainOpen) await revealInSight(tx, scope, session, [object.recordId]);
  });
}

/**
 * Reveals a record to players, or takes it back (§7, the GM's Reveal and Un-reveal), whether or
 * not a session is running; during one, the change is logged with the GM as its actor. Nothing
 * is logged when nothing changes. 404 for a record that isn't in this campaign.
 */
export async function setRecordRevealed(
  db: Database,
  scope: CampaignScope,
  recordId: string,
  revealed: boolean,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [record] = await tx
      .select({ revealedAt: records.revealedAt })
      .from(records)
      .where(and(eq(records.id, recordId), eq(records.campaignId, scope.campaignId)))
      .for('update');
    if (record === undefined) throw httpError(404, 'Record not found');
    if ((record.revealedAt !== null) === revealed) return;

    await tx
      .update(records)
      .set({ revealedAt: revealed ? new Date() : null, updatedAt: sql`${records.updatedAt}` })
      .where(and(eq(records.id, recordId), eq(records.campaignId, scope.campaignId)));
    const [session] = await tx
      .select({ id: playSessions.id })
      .from(playSessions)
      .where(running(scope));
    if (session === undefined) return;
    await logEvent(tx, scope, session, revealed ? 'reveal' : 'unreveal', {
      actorUserId: scope.userId,
      recordId,
    });
  });
}

/** An object on the stage, with what it shows and that one's image in use. */
interface Placed {
  object: ObjectRow;
  subject: StageSubject;
  visualAssetId: string | null;
}

/**
 * The live stage as the GM and as players get it, or null when no session is running.
 *
 * Images are the ones in use right now: the backdrop is the copied Spot's, and each object
 * shows its record's or its PC's. A player's view leaves out everything not shown, and anything
 * with no image to draw.
 */
export async function stagesOf(
  db: DbOrTx,
  scope: CampaignScope,
  now = Date.now(),
): Promise<{ gm: GmStage; player: PlayerStage } | null> {
  const [found] = await db
    .select({ session: playSessions, sceneName: scenes.name })
    .from(playSessions)
    .leftJoin(
      scenes,
      and(eq(scenes.id, playSessions.sceneId), eq(scenes.campaignId, playSessions.campaignId)),
    )
    .where(running(scope));
  if (found === undefined) return null;
  const { session, sceneName } = found;

  const [spot] =
    session.spotId === null
      ? []
      : await db
          .select({ visualAssetId: records.visualAssetId })
          .from(records)
          .where(
            and(
              eq(records.id, session.spotId),
              eq(records.campaignId, scope.campaignId),
              eq(records.type, 'spot'),
            ),
          );
  const rows = await db
    .select({
      object: playSessionObjects,
      record: {
        type: records.type,
        name: records.name,
        visualAssetId: records.visualAssetId,
        revealedAt: records.revealedAt,
      },
      pc: { name: characters.name, visualAssetId: characters.visualAssetId },
    })
    .from(playSessionObjects)
    .leftJoin(
      records,
      and(
        eq(records.id, playSessionObjects.recordId),
        eq(records.campaignId, playSessionObjects.campaignId),
      ),
    )
    .leftJoin(
      characters,
      and(
        eq(characters.id, playSessionObjects.characterId),
        eq(characters.campaignId, playSessionObjects.campaignId),
      ),
    )
    .where(
      and(
        eq(playSessionObjects.playSessionId, session.id),
        eq(playSessionObjects.campaignId, scope.campaignId),
      ),
    )
    .orderBy(asc(playSessionObjects.position));

  // Each object with what it shows; one whose record or PC isn't this campaign's is left out.
  const placed = rows.flatMap(({ object, record, pc }): Placed[] => {
    if (object.recordId !== null && record !== null) {
      return [
        {
          object,
          visualAssetId: record.visualAssetId,
          subject: {
            kind: 'record' as const,
            id: object.recordId,
            type: record.type,
            name: record.name,
            revealed: record.revealedAt !== null,
          },
        },
      ];
    }
    if (object.characterId !== null && pc !== null) {
      return [
        {
          object,
          visualAssetId: pc.visualAssetId,
          subject: { kind: 'pc' as const, id: object.characterId, name: pc.name },
        },
      ];
    }
    return [];
  });

  const images = await stageImagesOf(
    db,
    scope,
    [spot?.visualAssetId ?? null, ...placed.map((entry) => entry.visualAssetId)].flatMap(
      (assetId) => (assetId === null ? [] : [assetId]),
    ),
  );
  const imageOf = (assetId: string | null) =>
    assetId === null ? null : (images.get(assetId) ?? null);

  // A pass that is over counts as hidden or lowered at once (F5.4), written or not.
  const distance = travelDistance(clockOf(session), now);
  const inSight = (object: ObjectRow) =>
    object.shown && (object.passFrom === null || !passOver(object.passFrom, distance));
  const passFromOf = (object: ObjectRow) => (inSight(object) ? object.passFrom : null);

  const shared = {
    session: toPlaySession(session),
    sceneLoad: session.sceneLoads,
    curtainOpen: session.curtainOpen,
    backdrop: imageOf(spot?.visualAssetId ?? null),
    travel: session.transition ? { playing: session.travelSince !== null, distance } : null,
  };
  // Fear, the calls waiting and the last roll (F3.6): each role's own copy.
  const rolls = await rollStageOf(db, scope, session);

  const gm = gmStageSchema.parse({
    role: 'gm',
    ...shared,
    ...rolls.gm,
    scene:
      session.sceneId === null || sceneName === null
        ? null
        : { id: session.sceneId, name: sceneName },
    objects: placed.map(({ object, subject, visualAssetId }) => ({
      id: object.id,
      kind: object.kind,
      across: object.across,
      up: object.up,
      depthTick: object.depthTick,
      scale: object.scale,
      flipped: object.flipped,
      mount: object.mount,
      passFrom: passFromOf(object),
      subject,
      image: imageOf(visualAssetId),
      shown: inSight(object),
      travelMode: object.travelMode,
    })),
  });

  // Written out field by field: nothing reaches a player because it happened to be on a row.
  const player = playerStageSchema.parse({
    role: 'player',
    ...shared,
    ...rolls.player,
    objects: placed.flatMap(({ object, subject, visualAssetId }) => {
      const image = imageOf(visualAssetId);
      if (!inSight(object) || image === null) return [];
      return [
        {
          id: object.id,
          kind: object.kind,
          across: object.across,
          up: object.up,
          depthTick: object.depthTick,
          scale: object.scale,
          flipped: object.flipped,
          mount: object.mount,
          passFrom: passFromOf(object),
          image,
          // What a player may inspect (F3.5): a record they have, never a PC.
          recordId: subject.kind === 'record' && subject.revealed ? subject.id : null,
          // Whose puppet it is (F3.7): to emote it and to show who is talking.
          characterId: subject.kind === 'pc' ? subject.id : null,
        },
      ];
    }),
  });

  return { gm, player };
}

/**
 * Whether a player may load an asset's image: the image in use of a record in their journal
 * (F3.5), or, while it is, right now, the backdrop or an object in sight on the campaign's live
 * stage (F3.3). Everything else a campaign has drawn stays with the GM.
 */
export async function playerCanSeeAsset(
  db: Database,
  scope: CampaignScope,
  assetId: string,
): Promise<boolean> {
  if (await isRevealedRecordImage(db, scope, assetId)) return true;
  const stages = await stagesOf(db, scope);
  if (stages === null) return false;
  const { backdrop, objects } = stages.player;
  return (
    backdrop?.assetId === assetId || objects.some((object) => object.image.assetId === assetId)
  );
}
