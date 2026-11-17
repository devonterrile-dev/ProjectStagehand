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
 * - Rolls (F3.6): the GM calls them and corrects Hope and Fear; a player rolls only the call for
 *   their own PC, and the dice are rolled here (`rollDie`), never in a browser (§9).
 * - Everything sent about one campaign goes out in turn (`inTurn`): a join's snapshot and the
 *   broadcasts around it can't overtake each other, so nobody is left holding an older stage.
 */
import {
  actionResultSchema,
  addObjectRequestSchema,
  cancelRollRequestSchema,
  joinRequestSchema,
  joinResultSchema,
  loadSceneRequestSchema,
  makeRollRequestSchema,
  moveObjectRequestSchema,
  objectRequestSchema,
  PLAY_SOCKET,
  revealRollRequestSchema,
  rollCallRequestSchema,
  setFearRequestSchema,
  setHopeRequestSchema,
  spendFearRequestSchema,
  type ActionResult,
  type CampaignRole,
  type JoinResult,
} from '@stagehand/shared';
import { fromNodeHeaders } from 'better-auth/node';
import { randomInt } from 'node:crypto';
import type { FastifyBaseLogger } from 'fastify';
import type { DefaultEventsMap, Namespace, Server, Socket } from 'socket.io';
import type { z } from 'zod';

import type { Auth } from '../auth/auth';
import { presenceMemberOf } from '../campaigns/members';
import {
  addLiveObject,
  loadSceneLive,
  moveLiveObject,
  removeLiveObject,
  setCurtain,
  setLiveObjectShown,
  stagesOf,
} from '../campaigns/play-sessions';
import {
  callRolls,
  cancelRollCall,
  makeRoll,
  revealRoll,
  setFearLive,
  setHopeLive,
  spendFearLive,
  type RollDie,
} from '../campaigns/rolls';
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
  /**
   * Something the stage shows changed outside the live room, such as a record revealed from its
   * page: everyone in the session gets the stage again.
   */
  stageChanged(scope: CampaignScope): void;
  /**
   * Something in the journal changed (F3.5): a reveal, a note, an entry, a revealed record's
   * text. Everyone in the session is told, and reads it again.
   */
  journalChanged(campaignId: string): void;
  /** A PC's sheet changed (F3.6), such as the GM's edit on the site: its player reads it again. */
  sheetChanged(campaignId: string, characterId: string): void;
  /** The session's log grew outside the live room (a reveal from a record's page, F3.6). */
  logChanged(campaignId: string): void;
}

export interface PlaySocketDeps {
  auth: Auth;
  db: Database;
  log: FastifyBaseLogger;
  /** Rolls one d12 for a roll (F3.6): a secure random 1 to 12 unless a test passes its own. */
  rollDie?: RollDie;
}

/** What an action did beyond the stage, for the room to pass on (F3.6). */
interface Effects {
  /** It wrote to the session's log: the GM's desk reads the log again. */
  logged?: boolean;
  /** PCs whose sheets changed: their players read them again. */
  sheets?: readonly string[];
}

/** A secure d12. */
const secureDie: RollDie = () => randomInt(1, 13);

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
const ONLY_PLAYERS = 'Only players can do that';
const NOT_JOINED = 'Join the session first';
const NOT_ON_STAGE = 'Choose something on the stage';

export function registerPlaySocket(io: Server, deps: PlaySocketDeps): PlayLive {
  const { auth, db, log } = deps;
  const rollDie = deps.rollDie ?? secureDie;
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

  /** Tells everyone in the session that the journal changed (F3.5), so it is read again. */
  function sendJournalChanged(campaignId: string): void {
    nsp.to(room.gm(campaignId)).to(room.player(campaignId)).emit(PLAY_SOCKET.journalChanged);
  }

  /** Tells everyone in the session that a PC's sheet changed (F3.6). */
  function sendSheetChanged(campaignId: string, characterId: string): void {
    nsp
      .to(room.gm(campaignId))
      .to(room.player(campaignId))
      .emit(PLAY_SOCKET.sheetChanged, { characterId });
  }

  /** Tells the GM the session's log grew (F3.6). */
  function sendLogChanged(campaignId: string): void {
    nsp.to(room.gm(campaignId)).emit(PLAY_SOCKET.logChanged);
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
   * One action: checks the sender is seated and has, right now, the role it takes in this
   * campaign, runs it, answers, and sends everyone the stage and whatever else it changed. A
   * refusal is answered in our own words; a fault of ours with a fixed message.
   */
  async function act(
    socket: PlaySocket,
    role: CampaignRole,
    reply: (result: ActionResult) => void,
    run: (scope: CampaignScope) => Promise<Effects> | Promise<void>,
    reveals = false,
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
      if (scope?.role !== role) {
        refuse(role === 'gm' ? ONLY_GM : ONLY_PLAYERS);
        return;
      }
      const effects = (await run(scope)) ?? {};
      reply({ ok: true });
      await sendStage(scope);
      // Bringing something into sight may have revealed it (D-52): journals read again.
      if (reveals) sendJournalChanged(scope.campaignId);
      if (reveals || effects.logged === true) sendLogChanged(scope.campaignId);
      for (const characterId of effects.sheets ?? []) {
        sendSheetChanged(scope.campaignId, characterId);
      }
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

    /** An action with a payload: checked against `schema`, refused with `invalid` if it fails. */
    function on<T>(
      role: CampaignRole,
      event: string,
      schema: z.ZodType<T>,
      invalid: string,
      run: (scope: CampaignScope, request: T) => Promise<Effects> | Promise<void>,
      reveals = false,
    ): void {
      socket.on(event, (payload: unknown, reply: unknown) => {
        if (typeof reply !== 'function') return;
        const answer = reply as (result: ActionResult) => void;
        const parsed = schema.safeParse(payload);
        if (!parsed.success) {
          answer({ ok: false, message: invalid });
          return;
        }
        void act(socket, role, answer, (scope) => run(scope, parsed.data), reveals);
      });
    }
    function onGm<T>(
      event: string,
      schema: z.ZodType<T>,
      invalid: string,
      run: (scope: CampaignScope, request: T) => Promise<Effects> | Promise<void>,
      reveals = false,
    ): void {
      on('gm', event, schema, invalid, run, reveals);
    }

    onGm(
      PLAY_SOCKET.loadScene,
      loadSceneRequestSchema,
      'Choose a scene to load',
      (scope, request) => loadSceneLive(db, scope, request.sceneId),
      true,
    );

    // The control desk (F3.4).
    onGm(
      PLAY_SOCKET.addObject,
      addObjectRequestSchema,
      'Choose a record or a PC to add',
      (scope, request) => addLiveObject(db, scope, request),
      true,
    );
    onGm(
      PLAY_SOCKET.moveObject,
      moveObjectRequestSchema,
      'That place is not on the stage',
      (scope, request) => moveLiveObject(db, scope, request),
    );
    onGm(PLAY_SOCKET.removeObject, objectRequestSchema, NOT_ON_STAGE, (scope, { id }) =>
      removeLiveObject(db, scope, id),
    );
    for (const [event, kind, shown] of [
      [PLAY_SOCKET.showProp, 'prop', true],
      [PLAY_SOCKET.hideProp, 'prop', false],
      [PLAY_SOCKET.raisePuppet, 'puppet', true],
      [PLAY_SOCKET.lowerPuppet, 'puppet', false],
    ] as const) {
      onGm(
        event,
        objectRequestSchema,
        NOT_ON_STAGE,
        (scope, { id }) => setLiveObjectShown(db, scope, id, kind, shown),
        shown,
      );
    }

    for (const [event, open] of [
      [PLAY_SOCKET.openCurtain, true],
      [PLAY_SOCKET.closeCurtain, false],
    ] as const) {
      socket.on(event, (reply: unknown) => {
        if (typeof reply !== 'function') return;
        void act(
          socket,
          'gm',
          reply as (result: ActionResult) => void,
          (scope) => setCurtain(db, scope, open),
          open,
        );
      });
    }

    // Rolls, Hope and Fear (F3.6).
    onGm(
      PLAY_SOCKET.callRoll,
      rollCallRequestSchema,
      'Choose PCs, a trait and a difficulty',
      (scope, request) => callRolls(db, scope, request),
    );
    onGm(
      PLAY_SOCKET.cancelRoll,
      cancelRollRequestSchema,
      'Choose a called roll',
      (scope, request) => cancelRollCall(db, scope, request.callId),
    );
    onGm(
      PLAY_SOCKET.revealRoll,
      revealRollRequestSchema,
      'Choose a roll',
      async (scope, request) => {
        await revealRoll(db, scope, request.rollId);
        return { logged: true };
      },
    );
    onGm(
      PLAY_SOCKET.spendFear,
      spendFearRequestSchema,
      'Say how much Fear to spend',
      async (scope, request) => {
        await spendFearLive(db, scope, request);
        return { logged: true };
      },
    );
    onGm(PLAY_SOCKET.setFear, setFearRequestSchema, 'Say how much Fear', async (scope, request) => {
      await setFearLive(db, scope, request.fear);
      return { logged: true };
    });
    onGm(
      PLAY_SOCKET.setHope,
      setHopeRequestSchema,
      'Choose a PC and their Hope',
      async (scope, request) => {
        const changed = await setHopeLive(db, scope, request);
        return changed === null ? {} : { logged: true, sheets: [changed.characterId] };
      },
    );
    on(
      'player',
      PLAY_SOCKET.makeRoll,
      makeRollRequestSchema,
      'Choose a called roll',
      async (scope, request) => {
        const { characterId } = await makeRoll(db, scope, request, rollDie);
        return { logged: true, sheets: [characterId] };
      },
    );

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

    stageChanged(scope) {
      void sendStage(scope);
    },

    journalChanged(campaignId) {
      sendJournalChanged(campaignId);
    },

    sheetChanged(campaignId, characterId) {
      sendSheetChanged(campaignId, characterId);
    },

    logChanged(campaignId) {
      sendLogChanged(campaignId);
    },
  };
}
