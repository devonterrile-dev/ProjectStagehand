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
  type LiveStage,
  type Presence,
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

const INITIAL: RoomState = {
  phase: 'connecting',
  connected: false,
  stage: null,
  view: null,
  presence: [],
};

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

  function receive(stage: LiveStage): void {
    store.setState({ stage });
    show(onStage(transition, stage));
  }

  /** Empties the theater: out of the session, for whatever reason. */
  function forgetStage(): void {
    if (curtainTimer !== null) window.clearTimeout(curtainTimer);
    curtainTimer = null;
    loadingFor = null;
    transition = NO_STAGE;
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
          store.setState({ phase: 'joined', presence: result.presence });
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
  };
}
