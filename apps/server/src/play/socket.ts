/**
 * The live room (F3.3b, governance §13, D-50): the Socket.IO namespace a session is played in.
 * The messages are described with `PLAY_SOCKET` in the shared package.
 *
 * - A connection needs a Stagehand session cookie; it carries that user from then on.
 * - A browser joins one campaign's session at a time. Membership is checked at every join and
 *   the role at every GM action, from the database, never from what the browser says (§14).
 * - The stage is always read from the database (`stagesOf`), so what is sent after a change is
 *   what a browser joining a moment later would get, and a restart of this process loses
 *   nothing. Who is connected is the only state kept here (`PlayHub`).
 * - Everything sent about one campaign goes out in turn (`inTurn`): a join's snapshot and the
 *   broadcasts around it can't overtake each other, so nobody is left holding an older stage.
 */
import {
  actionResultSchema,
  joinRequestSchema,
  joinResultSchema,
  loadSceneRequestSchema,
  PLAY_SOCKET,
  type ActionResult,
  type CampaignRole,
  type JoinResult,
} from '@stagehand/shared';
import { fromNodeHeaders } from 'better-auth/node';
import type { FastifyBaseLogger } from 'fastify';
import type { DefaultEventsMap, Namespace, Server, Socket } from 'socket.io';

import type { Auth } from '../auth/auth';
import { presenceMemberOf } from '../campaigns/members';
import { loadSceneLive, setCurtain, stagesOf } from '../campaigns/play-sessions';
import { loadCampaignScope, type CampaignScope } from '../campaigns/scope';
import type { Database } from '../db/client';
import { reportError } from '../http/errors';

import { PlayHub } from './hub';

/** What the rest of the server tells the live room. Each returns at once. */
export interface PlayLive {
  /** A session began: members waiting on the play page are told, and join. */
  sessionStarted(campaignId: string): void;
  /** The session ended: everyone in it is told, and goes back to waiting. */
  sessionEnded(campaignId: string): void;
  /** Someone left the campaign or was removed: their connections to it are dropped. */
  memberRemoved(campaignId: string, userId: string): void;
}

export interface PlaySocketDeps {
  auth: Auth;
  db: Database;
  log: FastifyBaseLogger;
}

interface SocketData {
  userId: string;
  /** The session this connection is in. */
  seat: { campaignId: string; role: CampaignRole } | null;
  /** The campaign whose session this connection is waiting for (none running, or full). */
  waiting: string | null;
}

type PlayNamespace = Namespace<DefaultEventsMap, DefaultEventsMap, DefaultEventsMap, SocketData>;
type PlaySocket = Socket<DefaultEventsMap, DefaultEventsMap, DefaultEventsMap, SocketData>;

const room = {
  gm: (campaignId: string) => `play:${campaignId}:gm`,
  player: (campaignId: string) => `play:${campaignId}:player`,
  waiting: (campaignId: string) => `play:${campaignId}:waiting`,
};

/**
 * Most messages one connection may send in a stretch of time. Running a session takes a
 * handful a minute; anything near this is a broken or hostile page, and is disconnected.
 */
export const EVENT_BUDGET = { events: 60, perMs: 10_000 } as const;

const ONLY_GM = 'Only the GM can do that';
const NOT_JOINED = 'Join the session first';

export function registerPlaySocket(io: Server, deps: PlaySocketDeps): PlayLive {
  const { auth, db, log } = deps;
  const nsp = io.of(PLAY_SOCKET.namespace) as PlayNamespace;
  const hub = new PlayHub();

  /** Logged by kind only: an error's own words could quote campaign text (§14). */
  function logFault(error: unknown, what: string): void {
    log.error({ err: reportError(error).log }, what);
  }

  /** The last thing queued for each campaign. */
  const turns = new Map<string, Promise<void>>();

  /** Runs `work` after everything already queued for the campaign. Never rejects. */
  function inTurn(
    campaignId: string,
    what: string,
    work: () => Promise<void> | void,
  ): Promise<void> {
    const turn = (turns.get(campaignId) ?? Promise.resolve())
      .then(work)
      .catch((error: unknown) => {
        logFault(error, what);
      })
      .finally(() => {
        if (turns.get(campaignId) === turn) turns.delete(campaignId);
      });
    turns.set(campaignId, turn);
    return turn;
  }

  function sendPresence(campaignId: string): void {
    nsp
      .to(room.gm(campaignId))
      .to(room.player(campaignId))
      .emit(PLAY_SOCKET.presence, hub.presence(campaignId));
  }

  /** Sends each role its view of the stage as it is now. */
  function sendStage(scope: CampaignScope): Promise<void> {
    return inTurn(scope.campaignId, 'live stage broadcast failed', async () => {
      const stages = await stagesOf(db, scope);
      if (stages === null) return;
      nsp.to(room.gm(scope.campaignId)).emit(PLAY_SOCKET.stage, stages.gm);
      nsp.to(room.player(scope.campaignId)).emit(PLAY_SOCKET.stage, stages.player);
    });
  }

  /** Takes a connection out of whatever session or wait it is in. */
  function vacate(socket: PlaySocket): void {
    const { seat, waiting, userId } = socket.data;
    if (waiting !== null) {
      socket.data.waiting = null;
      void socket.leave(room.waiting(waiting));
    }
    if (seat === null) return;
    socket.data.seat = null;
    void socket.leave(room[seat.role](seat.campaignId));
    if (hub.leave(seat.campaignId, userId, socket.id)) sendPresence(seat.campaignId);
  }

  function wait(socket: PlaySocket, campaignId: string): void {
    socket.data.waiting = campaignId;
    void socket.join(room.waiting(campaignId));
  }

  /** Seats the connection in the campaign's session, or says why not. */
  async function admit(socket: PlaySocket, scope: CampaignScope): Promise<JoinResult> {
    const stages = await stagesOf(db, scope);
    if (stages === null) {
      wait(socket, scope.campaignId);
      return { status: 'no-session' };
    }
    const member = await presenceMemberOf(db, scope);
    // The connection may have gone while the database was asked.
    if (socket.disconnected) return { status: 'not-found' };
    if (!hub.enter(scope.campaignId, member, socket.id)) {
      wait(socket, scope.campaignId);
      return { status: 'full' };
    }
    socket.data.seat = { campaignId: scope.campaignId, role: scope.role };
    void socket.join(room[scope.role](scope.campaignId));
    sendPresence(scope.campaignId);
    return {
      status: 'joined',
      stage: scope.role === 'gm' ? stages.gm : stages.player,
      presence: hub.presence(scope.campaignId),
    };
  }

  /**
   * One GM action: checks the sender is seated and is, right now, this campaign's GM, runs it,
   * answers, and sends everyone the stage. A refusal is answered in our own words; a fault of
   * ours with a fixed message.
   */
  async function gmAction(
    socket: PlaySocket,
    reply: (result: ActionResult) => void,
    run: (scope: CampaignScope) => Promise<void>,
  ): Promise<void> {
    const refuse = (message: string) => {
      reply(actionResultSchema.parse({ ok: false, message }));
    };
    const { seat, userId } = socket.data;
    if (seat === null) {
      refuse(NOT_JOINED);
      return;
    }
    try {
      const scope = await loadCampaignScope(db, userId, seat.campaignId);
      if (scope?.role !== 'gm') {
        refuse(ONLY_GM);
        return;
      }
      await run(scope);
      reply({ ok: true });
      await sendStage(scope);
    } catch (error) {
      const report = reportError(error);
      if (report.statusCode >= 500) log.error({ err: report.log }, 'live action failed');
      refuse(report.body.message);
    }
  }

  // No Stagehand session, no connection.
  nsp.use((socket, next) => {
    auth.api
      .getSession({ headers: fromNodeHeaders(socket.request.headers) })
      .then((session) => {
        if (session === null) {
          next(new Error('unauthorized'));
          return;
        }
        socket.data.userId = session.user.id;
        socket.data.seat = null;
        socket.data.waiting = null;
        next();
      })
      .catch((error: unknown) => {
        logFault(error, 'live room sign-in check failed');
        next(new Error('unauthorized'));
      });
  });

  nsp.on('connection', (socket) => {
    let windowStart = Date.now();
    let events = 0;
    socket.use((_packet, next) => {
      const now = Date.now();
      if (now - windowStart > EVENT_BUDGET.perMs) {
        windowStart = now;
        events = 0;
      }
      events += 1;
      if (events > EVENT_BUDGET.events) {
        socket.disconnect(true);
        return;
      }
      next();
    });

    socket.on(PLAY_SOCKET.join, (payload: unknown, reply: unknown) => {
      if (typeof reply !== 'function') return;
      const answer = (result: JoinResult) => {
        (reply as (result: JoinResult) => void)(joinResultSchema.parse(result));
      };
      const parsed = joinRequestSchema.safeParse(payload);
      if (!parsed.success) {
        answer({ status: 'not-found' });
        return;
      }
      const { campaignId } = parsed.data;

      void (async () => {
        const scope = await loadCampaignScope(db, socket.data.userId, campaignId);
        // Joining leaves whatever this connection was in, even when the new join is refused.
        vacate(socket);
        if (scope === null) {
          answer({ status: 'not-found' });
          return;
        }
        await inTurn(campaignId, 'live join failed', async () => {
          answer(await admit(socket, scope));
        });
      })().catch((error: unknown) => {
        // Unanswered: the browser's wait runs out and it asks again.
        logFault(error, 'live join failed');
      });
    });

    socket.on(PLAY_SOCKET.loadScene, (payload: unknown, reply: unknown) => {
      if (typeof reply !== 'function') return;
      const answer = reply as (result: ActionResult) => void;
      const parsed = loadSceneRequestSchema.safeParse(payload);
      if (!parsed.success) {
        answer({ ok: false, message: 'Choose a scene to load' });
        return;
      }
      void gmAction(socket, answer, (scope) => loadSceneLive(db, scope, parsed.data.sceneId));
    });

    for (const [event, open] of [
      [PLAY_SOCKET.openCurtain, true],
      [PLAY_SOCKET.closeCurtain, false],
    ] as const) {
      socket.on(event, (reply: unknown) => {
        if (typeof reply !== 'function') return;
        void gmAction(socket, reply as (result: ActionResult) => void, (scope) =>
          setCurtain(db, scope, open),
        );
      });
    }

    socket.on('disconnect', () => {
      vacate(socket);
    });
  });

  return {
    sessionStarted(campaignId) {
      nsp.to(room.waiting(campaignId)).emit(PLAY_SOCKET.started);
    },

    sessionEnded(campaignId) {
      void inTurn(campaignId, 'live session end failed', () => {
        nsp
          .to(room.gm(campaignId))
          .to(room.player(campaignId))
          .to(room.waiting(campaignId))
          .emit(PLAY_SOCKET.ended);
        hub.clear(campaignId);
        // Everyone who was in it now waits for the next one.
        for (const socket of nsp.sockets.values()) {
          const { seat } = socket.data;
          if (seat?.campaignId !== campaignId) continue;
          socket.data.seat = null;
          void socket.leave(room[seat.role](campaignId));
          wait(socket, campaignId);
        }
      });
    },

    memberRemoved(campaignId, userId) {
      for (const socket of nsp.sockets.values()) {
        const { seat, waiting } = socket.data;
        if (socket.data.userId !== userId) continue;
        if (seat?.campaignId !== campaignId && waiting !== campaignId) continue;
        vacate(socket);
        socket.disconnect(true);
      }
    },
  };
}
