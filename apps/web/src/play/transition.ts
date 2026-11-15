/**
 * Changing scene behind the curtain (F3.3, governance §13 `scene:load`). The server changes the
 * stage in one step; each browser closes its own curtain, swaps the scene once the new images
 * have loaded, and opens again. Pure: `room.ts` runs the waits.
 *
 * Arriving in a session is played the same way, from a closed curtain: the theater is filled
 * behind it, then it opens, instead of cutouts popping in one by one.
 */
import type { LiveStage } from '@stagehand/shared';

/** What the theater draws: a stage, and where the curtain should be. */
export interface StageView {
  stage: LiveStage;
  curtainOpen: boolean;
}

export type Transition =
  /** Showing what the server last sent. `view` is null before the first stage arrives. */
  | { step: 'idle'; view: StageView | null }
  /** The curtain is closing on the old scene; `next` waits behind it. */
  | { step: 'closing'; view: StageView; next: LiveStage }
  /** The curtain is closed (or nothing is drawn yet) while `next`'s images load. */
  | { step: 'loading'; view: StageView | null; next: LiveStage };

export const NO_STAGE: Transition = { step: 'idle', view: null };

/** Whether two stages show the same loaded scene of the same session. */
function sameScene(a: LiveStage, b: LiveStage): boolean {
  return a.session.id === b.session.id && a.sceneLoad === b.sceneLoad;
}

/** The server sent a stage. */
export function onStage(state: Transition, incoming: LiveStage): Transition {
  // Mid-change: the newest stage is the one that will be shown.
  if (state.step !== 'idle') return { ...state, next: incoming };

  const { view } = state;
  if (view === null) return { step: 'loading', view: null, next: incoming };
  // The same scene: a curtain move or a live edit, shown at once.
  if (sameScene(view.stage, incoming)) {
    return { step: 'idle', view: { stage: incoming, curtainOpen: incoming.curtainOpen } };
  }
  // Another scene. A curtain that is already closed has nothing to wait for.
  if (!view.curtainOpen) return { step: 'loading', view, next: incoming };
  return { step: 'closing', view: { stage: view.stage, curtainOpen: false }, next: incoming };
}

/** The curtain has had time to close. */
export function onCurtainClosed(state: Transition): Transition {
  return state.step === 'closing' ? { ...state, step: 'loading' } : state;
}

/** The waiting scene's images have loaded (or took too long). */
export function onImagesReady(state: Transition): Transition {
  if (state.step !== 'loading') return state;
  return { step: 'idle', view: { stage: state.next, curtainOpen: state.next.curtainOpen } };
}
