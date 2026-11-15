/**
 * Live sessions (F3.3, governance §13, D-50). Part of the campaign data-access layer: every
 * query is scoped to `scope.campaignId`. The only code that queries `play_sessions` and
 * `play_session_objects`.
 *
 * A campaign has at most one running session. Its stage is a copy of the scene that was loaded
 * (`loadSceneLive`), read back as two views (`stagesOf`): everything for the GM, and for
 * players only what is in sight, built from its own short list of fields and never by trimming
 * the GM's. Callers check `assertGm` for everything that changes a session.
 */
import {
  gmStageSchema,
  playerStageSchema,
  playSessionSchema,
  rulesetFor,
  type GmStage,
  type PlayerStage,
  type PlaySession,
} from '@stagehand/shared';
import { and, asc, eq, isNull, max, sql } from 'drizzle-orm';

import type { Database } from '../db/client';
import { campaigns, playSessionObjects, playSessions, records, scenes } from '../db/schema';
import { httpError } from '../http/errors';

import type { DbOrTx } from './members';
import { sceneForStage } from './scenes';
import type { CampaignScope } from './scope';
import { stageImagesOf } from './visuals';

type SessionRow = typeof playSessions.$inferSelect;

export const NO_SESSION = 'No session is running';

/** `campaign_id = scope.campaignId and ended_at is null`: the campaign's running session. */
function running(scope: CampaignScope) {
  return and(eq(playSessions.campaignId, scope.campaignId), isNull(playSessions.endedAt));
}

function toPlaySession(row: SessionRow): PlaySession {
  return playSessionSchema.parse({
    id: row.id,
    number: row.number,
    startedAt: row.startedAt.toISOString(),
  });
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

/** Ends the running session and clears its stage. 404 when none is running. */
export async function endSession(db: Database, scope: CampaignScope): Promise<void> {
  await db.transaction(async (tx) => {
    const [ended] = await tx
      .update(playSessions)
      .set({ endedAt: new Date() })
      .where(running(scope))
      .returning({ id: playSessions.id });
    if (ended === undefined) throw httpError(404, NO_SESSION);
    await tx.delete(playSessionObjects).where(eq(playSessionObjects.playSessionId, ended.id));
  });
}

/**
 * Loads a scene onto the live stage (§13 `scene:load`): the stage becomes a copy of the scene's
 * Spot and objects, as saved (hidden props hidden, puppets lowered), and the curtain ends up
 * open. Browsers do the closing and opening around the swap themselves. 409 when no session is
 * running, 404 for a scene that isn't in this campaign.
 */
export async function loadSceneLive(
  db: Database,
  scope: CampaignScope,
  sceneId: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [session] = await tx
      .select({ id: playSessions.id })
      .from(playSessions)
      .where(running(scope))
      .for('update');
    if (session === undefined) throw httpError(409, NO_SESSION);

    const scene = await sceneForStage(tx, scope, sceneId);
    if (scene === null) throw httpError(404, 'Scene not found');

    await tx.delete(playSessionObjects).where(eq(playSessionObjects.playSessionId, session.id));
    if (scene.objects.length > 0) {
      await tx.insert(playSessionObjects).values(
        scene.objects.map((object) => ({
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
        curtainOpen: true,
      })
      .where(eq(playSessions.id, session.id));
  });
}

/** Opens or closes the front curtain for everyone. 409 when no session is running. */
export async function setCurtain(db: Database, scope: CampaignScope, open: boolean): Promise<void> {
  const changed = await db
    .update(playSessions)
    .set({ curtainOpen: open })
    .where(running(scope))
    .returning({ id: playSessions.id });
  if (changed.length === 0) throw httpError(409, NO_SESSION);
}

/**
 * The live stage as the GM and as players get it, or null when no session is running.
 *
 * Images are the ones in use right now: the backdrop is the copied Spot's, and each object
 * shows its record's. A player's view leaves out everything not shown, and anything with no
 * image to draw.
 */
export async function stagesOf(
  db: DbOrTx,
  scope: CampaignScope,
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
  const placed = await db
    .select({
      object: playSessionObjects,
      type: records.type,
      name: records.name,
      visualAssetId: records.visualAssetId,
    })
    .from(playSessionObjects)
    .innerJoin(
      records,
      and(
        eq(records.id, playSessionObjects.recordId),
        eq(records.campaignId, playSessionObjects.campaignId),
      ),
    )
    .where(
      and(
        eq(playSessionObjects.playSessionId, session.id),
        eq(playSessionObjects.campaignId, scope.campaignId),
      ),
    )
    .orderBy(asc(playSessionObjects.position));

  const images = await stageImagesOf(
    db,
    scope,
    [spot, ...placed].flatMap((source) => {
      const assetId = source?.visualAssetId ?? null;
      return assetId === null ? [] : [assetId];
    }),
  );
  const imageOf = (assetId: string | null) =>
    assetId === null ? null : (images.get(assetId) ?? null);

  const shared = {
    session: toPlaySession(session),
    sceneLoad: session.sceneLoads,
    curtainOpen: session.curtainOpen,
    backdrop: imageOf(spot?.visualAssetId ?? null),
  };

  const gm = gmStageSchema.parse({
    role: 'gm',
    ...shared,
    scene:
      session.sceneId === null || sceneName === null
        ? null
        : { id: session.sceneId, name: sceneName },
    objects: placed.map(({ object, type, name, visualAssetId }) => ({
      id: object.id,
      kind: object.kind,
      across: object.across,
      up: object.up,
      depthTick: object.depthTick,
      scale: object.scale,
      flipped: object.flipped,
      mount: object.mount,
      record: { id: object.recordId, type, name },
      image: imageOf(visualAssetId),
      shown: object.shown,
    })),
  });

  // Written out field by field: nothing reaches a player because it happened to be on a row.
  const player = playerStageSchema.parse({
    role: 'player',
    ...shared,
    objects: placed.flatMap(({ object, visualAssetId }) => {
      const image = imageOf(visualAssetId);
      if (!object.shown || image === null) return [];
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
          image,
        },
      ];
    }),
  });

  return { gm, player };
}

/**
 * Whether a player may load an asset's image (F3.3): only while it is, right now, the backdrop
 * or an object in sight on the campaign's live stage. Everything else a campaign has drawn stays
 * with the GM.
 */
export async function playerCanSeeAsset(
  db: Database,
  scope: CampaignScope,
  assetId: string,
): Promise<boolean> {
  const stages = await stagesOf(db, scope);
  if (stages === null) return false;
  const { backdrop, objects } = stages.player;
  return (
    backdrop?.assetId === assetId || objects.some((object) => object.image.assetId === assetId)
  );
}
