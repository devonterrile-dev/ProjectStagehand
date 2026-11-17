/**
 * A browser's side of the live room (F3.3b, governance §13): it connects, asks to join the
 * campaign's session, and keeps what the server sends in a store the play page draws from.
 * Plain TypeScript, no React: the page only reads the store and calls the actions.
 *
 * The server is the only source of the stage. After every reconnect the browser joins again
 * and takes the stage it is given, so nothing here is ever trusted over a fresh answer.
 */
import {
  actionResultSchema,
  joinResultSchema,
  liveStageSchema,
  PLAY_SOCKET,
  presenceSchema,
  type ActionResult,
  type AddObjectRequest,
  type LiveStage,
  type ObjectChanges,
  type Presence,
  type SceneObjectKind,
} from '@stagehand/shared';
import { createStore, type StoreApi } from 'zustand/vanilla';

import { preloadImages } from './preload';
import { createPlaySocket, type PlaySocket } from './socket';
import { stageImageUrls } from './stage';
import {
  NO_STAGE,
  onCurtainClosed,
  onImagesReady,
  onStage,
  type StageView,
  type Transition,
} from './transition';

export type RoomPhase =
  /** No answer yet to a request to join. */
  | 'connecting'
  /** In the session: `stage` and `view` are set. */
  | 'joined'
  /** No session is running. The server says when one starts. */
  | 'waiting'
  /** The session has its 6 players already. */
  | 'full'
  /** The session this browser was in has ended. */
  | 'ended'
  /** Not a member of this campaign (any more). */
  | 'not-found'
  /** The Stagehand sign-in has run out. */
  | 'signed-out';

export interface RoomState {
  phase: RoomPhase;
  /** False while the connection is down. What was last shown stays on screen meanwhile. */
  connected: boolean;
  /** The stage as the server last sent it: what the GM's desk describes. */
  stage: LiveStage | null;
  /**
   * The stage as the theater draws it right now. It trails `stage` while the curtain closes
   * and the next scene's images load (`transition.ts`).
   */
  view: StageView | null;
  /** Everyone connected to the session. */
  presence: Presence;
  /**
   * The GM's moves not yet seen back from the server, by object (F3.4): the GM's theater and
   * desk show them at once, while the stage catches up.
   */
  pending: Readonly<Record<string, ObjectChanges>>;
  /**
   * Goes up each time the journal may have changed (F3.5b): the server said so
   * (`journal:changed`), or the browser (re)joined and may have missed it. The page reads the
   * journal again when it does.
   */
  journal: number;
}

export interface PlayRoom {
  store: StoreApi<RoomState>;
  /** Connects. Safe to call again after `close`. */
  open(): void;
  /** Disconnects and forgets everything. */
  close(): void;
  /** Asks to join again: for "Try again" when the session was full. */
  join(): void;
  /** GM only; the server refuses anyone else. */
  loadScene(sceneId: string): Promise<ActionResult>;
  setCurtain(open: boolean): Promise<ActionResult>;
  /** The control desk (F3.4). */
  addObject(request: AddObjectRequest): Promise<ActionResult>;
  /**
   * Moves an object or changes how it is drawn. Shown at once in `pending`; changes made in
   * quick succession (a drag, a slider) go to the server together, at most every
   * `MOVE_GAP_MS`, each answered with the result of the send that carried it.
   */
  moveObject(id: string, changes: ObjectChanges): Promise<ActionResult>;
  removeObject(id: string): Promise<ActionResult>;
  /** Shows or hides a prop, or raises or lowers a puppet. */
  setShown(object: { id: string; kind: SceneObjectKind }, shown: boolean): Promise<ActionResult>;
}

export interface RoomDeps {
  socket?: PlaySocket;
  preload?: (urls: readonly string[]) => Promise<void>;
}

/** How long the theater's curtain takes to close (`stage/Curtain.tsx`), with a little to spare. */
export const CURTAIN_CLOSE_MS = 1200;
/** How long to wait before asking again after a request went unanswered. */
export const RETRY_MS = 2000;

export const NO_ANSWER = "The server didn't answer. Try again.";

/**
 * The least time between two moves of one object sent to the server: a drag sends a few a
 * second, well inside what the live room lets one connection send (60 in 10 seconds).
 */
export const MOVE_GAP_MS = 300;

const INITIAL: RoomState = {
  phase: 'connecting',
  connected: false,
  stage: null,
  view: null,
  presence: [],
  pending: {},
  journal: 0,
};

/** Whether the stage already shows every change in `changes`, or no longer has the object. */
function showsChanges(stage: LiveStage, id: string, changes: ObjectChanges): boolean {
  const object = stage.objects.find((candidate) => candidate.id === id);
  if (object === undefined) return true;
  return Object.entries(changes).every(
    ([key, value]) => object[key as keyof ObjectChanges] === value,
  );
}

/** Bringing an object into sight or out of it: a prop is shown or hidden, a puppet raised or lowered. */
const SHOWN_EVENTS = {
  prop: { on: PLAY_SOCKET.showProp, off: PLAY_SOCKET.hideProp },
  puppet: { on: PLAY_SOCKET.raisePuppet, off: PLAY_SOCKET.lowerPuppet },
} as const;

/** One object's moves: what waits to be sent, who waits for an answer, and the send in hand. */
interface Moves {
  queued: ObjectChanges | null;
  waiters: ((result: ActionResult) => void)[];
  busy: boolean;
  timer: number | null;
}

export function createPlayRoom(campaignId: string, deps: RoomDeps = {}): PlayRoom {
  const socket = deps.socket ?? createPlaySocket();
  const preload = deps.preload ?? preloadImages;
  const store = createStore<RoomState>(() => INITIAL);

  let isOpen = false;
  let transition: Transition = NO_STAGE;
  let curtainTimer: number | null = null;
  /** The stage whose images are loading; a newer one replaces it. */
  let loadingFor: LiveStage | null = null;
  /** Counts requests to join: only the newest one's answer is used. */
  let joinAttempt = 0;
  let retryTimer: number | null = null;

  function clearRetry(): void {
    if (retryTimer !== null) window.clearTimeout(retryTimer);
    retryTimer = null;
  }

  /** Takes a step of the scene change, and starts whatever wait that step needs. */
  function show(next: Transition): void {
    transition = next;
    store.setState({ view: next.view });

    if (next.step === 'closing') {
      curtainTimer ??= window.setTimeout(() => {
        curtainTimer = null;
        show(onCurtainClosed(transition));
      }, CURTAIN_CLOSE_MS);
      return;
    }
    if (next.step === 'loading' && loadingFor !== next.next) {
      const target = next.next;
      loadingFor = target;
      void preload(stageImageUrls(campaignId, target)).then(() => {
        // A newer stage arrived meanwhile: its own images are the ones to wait for.
        if (loadingFor !== target) return;
        loadingFor = null;
        show(onImagesReady(transition));
      });
    }
  }

  const moves = new Map<string, Moves>();

  /** Drops from `pending` what the stage now shows, unless more of it is still on its way. */
  function settle(stage: LiveStage): void {
    const { pending } = store.getState();
    const left = Object.fromEntries(
      Object.entries(pending).filter(([id, changes]) => {
        const move = moves.get(id);
        const inFlight = move !== undefined && (move.busy || move.queued !== null);
        return inFlight || !showsChanges(stage, id, changes);
      }),
    );
    if (Object.keys(left).length !== Object.keys(pending).length) store.setState({ pending: left });
  }

  function receive(stage: LiveStage): void {
    store.setState({ stage });
    settle(stage);
    show(onStage(transition, stage));
  }

  function forgetMoves(): void {
    for (const move of moves.values()) {
      if (move.timer !== null) window.clearTimeout(move.timer);
      for (const waiter of move.waiters) waiter({ ok: false, message: NO_ANSWER });
    }
    moves.clear();
    store.setState({ pending: {} });
  }

  /** Sends an object's queued moves; whatever is queued meanwhile follows after the gap. */
  function flush(id: string): void {
    const move = moves.get(id);
    if (move?.queued == null || move.busy) return;
    const changes = move.queued;
    const waiters = move.waiters;
    move.queued = null;
    move.waiters = [];
    move.busy = true;
    const sentAt = Date.now();
    void act(PLAY_SOCKET.moveObject, { id, ...changes }).then((result) => {
      // Forgotten meanwhile: out of the session.
      if (moves.get(id) !== move) return;
      move.busy = false;
      for (const waiter of waiters) waiter(result);
      if (move.queued !== null) {
        move.timer = window.setTimeout(
          () => {
            move.timer = null;
            flush(id);
          },
          Math.max(0, MOVE_GAP_MS - (Date.now() - sentAt)),
        );
        return;
      }
      moves.delete(id);
      const { stage, pending } = store.getState();
      // Refused, or already shown: the server's stage is the one to draw.
      if (!result.ok || (stage !== null && showsChanges(stage, id, pending[id] ?? {}))) {
        store.setState({
          pending: Object.fromEntries(Object.entries(pending).filter(([key]) => key !== id)),
        });
      }
    });
  }

  function moveObject(id: string, changes: ObjectChanges): Promise<ActionResult> {
    const { pending } = store.getState();
    store.setState({ pending: { ...pending, [id]: { ...pending[id], ...changes } } });
    let move = moves.get(id);
    if (move === undefined) {
      move = { queued: null, waiters: [], busy: false, timer: null };
      moves.set(id, move);
    }
    const current = move;
    current.queued = { ...current.queued, ...changes };
    const answered = new Promise<ActionResult>((resolve) => {
      current.waiters.push(resolve);
    });
    if (!current.busy && current.timer === null) flush(id);
    return answered;
  }

  /** Empties the theater: out of the session, for whatever reason. */
  function forgetStage(): void {
    if (curtainTimer !== null) window.clearTimeout(curtainTimer);
    curtainTimer = null;
    loadingFor = null;
    transition = NO_STAGE;
    forgetMoves();
    store.setState({ stage: null, view: null, presence: [] });
  }

  function retryJoinLater(): void {
    clearRetry();
    if (!isOpen || !store.getState().connected) return;
    retryTimer = window.setTimeout(join, RETRY_MS);
  }

  function join(): void {
    clearRetry();
    joinAttempt += 1;
    const attempt = joinAttempt;
    socket.request(PLAY_SOCKET.join, { campaignId }).then(
      (answer) => {
        if (attempt !== joinAttempt || !isOpen) return;
        const parsed = joinResultSchema.safeParse(answer);
        if (!parsed.success) {
          retryJoinLater();
          return;
        }
        const result = parsed.data;
        if (result.status === 'joined') {
          store.setState({
            phase: 'joined',
            presence: result.presence,
            journal: store.getState().journal + 1,
          });
          receive(result.stage);
          return;
        }
        const wasEnded = store.getState().phase === 'ended';
        forgetStage();
        store.setState({
          phase: result.status === 'no-session' ? (wasEnded ? 'ended' : 'waiting') : result.status,
        });
      },
      () => {
        if (attempt === joinAttempt) retryJoinLater();
      },
    );
  }

  /** The server closed the connection, or refused it for now: try again shortly. */
  function reconnectLater(): void {
    clearRetry();
    if (!isOpen) return;
    retryTimer = window.setTimeout(() => {
      retryTimer = null;
      if (isOpen) socket.connect();
    }, RETRY_MS);
  }

  socket.on('connect', () => {
    if (!isOpen) return;
    store.setState({ connected: true });
    join();
  });

  socket.on('disconnect', (reason) => {
    if (!isOpen) return;
    // An answer to a join sent before the drop is no longer worth anything.
    joinAttempt += 1;
    clearRetry();
    store.setState({ connected: false });
    // Socket.IO reconnects by itself, except after the server hung up on purpose (a removed
    // member). Coming back then gets a plain answer from `join`.
    if (reason === 'io server disconnect') reconnectLater();
  });

  socket.on('connect_error', (error) => {
    if (!isOpen) return;
    store.setState({ connected: false });
    if (socket.retrying()) return;
    if (error instanceof Error && error.message === 'unauthorized') {
      forgetStage();
      store.setState({ phase: 'signed-out' });
      return;
    }
    reconnectLater();
  });

  socket.on(PLAY_SOCKET.stage, (payload) => {
    const parsed = liveStageSchema.safeParse(payload);
    if (!isOpen || !parsed.success || store.getState().phase !== 'joined') return;
    receive(parsed.data);
  });

  socket.on(PLAY_SOCKET.presence, (payload) => {
    const parsed = presenceSchema.safeParse(payload);
    if (!isOpen || !parsed.success || store.getState().phase !== 'joined') return;
    store.setState({ presence: parsed.data });
  });

  socket.on(PLAY_SOCKET.journalChanged, () => {
    if (!isOpen || store.getState().phase !== 'joined') return;
    store.setState({ journal: store.getState().journal + 1 });
  });

  socket.on(PLAY_SOCKET.started, () => {
    if (isOpen) join();
  });

  socket.on(PLAY_SOCKET.ended, () => {
    if (!isOpen) return;
    joinAttempt += 1;
    forgetStage();
    store.setState({ phase: 'ended' });
  });

  async function act(event: string, payload?: unknown): Promise<ActionResult> {
    try {
      const parsed = actionResultSchema.safeParse(await socket.request(event, payload));
      if (parsed.success) return parsed.data;
    } catch {
      // No answer in time: said below.
    }
    return { ok: false, message: NO_ANSWER };
  }

  return {
    store,
    open() {
      if (isOpen) return;
      isOpen = true;
      socket.connect();
    },
    close() {
      isOpen = false;
      joinAttempt += 1;
      clearRetry();
      forgetStage();
      store.setState(INITIAL);
      socket.disconnect();
    },
    join() {
      if (isOpen && store.getState().connected) join();
    },
    loadScene: (sceneId) => act(PLAY_SOCKET.loadScene, { sceneId }),
    setCurtain: (open) => act(open ? PLAY_SOCKET.openCurtain : PLAY_SOCKET.closeCurtain),
    addObject: (request) => act(PLAY_SOCKET.addObject, request),
    moveObject,
    removeObject: (id) => act(PLAY_SOCKET.removeObject, { id }),
    setShown: ({ id, kind }, shown) => act(SHOWN_EVENTS[kind][shown ? 'on' : 'off'], { id }),
  };
}
