import { describe, expect, it } from 'vitest';

import { playerStage, SESSION } from '@/test/play-fixtures';

import { NO_STAGE, onCurtainClosed, onImagesReady, onStage, type Transition } from './transition';

const market = playerStage({ sceneLoad: 1 });
const cellar = playerStage({ sceneLoad: 2, backdrop: null });

/** Showing `stage`, with nothing in progress. */
const showing = (stage = market, curtainOpen = stage.curtainOpen): Transition => ({
  step: 'idle',
  view: { stage, curtainOpen },
});

describe('arriving in a session', () => {
  it('fills the theater behind a closed curtain, then opens it', () => {
    const loading = onStage(NO_STAGE, market);
    expect(loading).toEqual({ step: 'loading', view: null, next: market });

    expect(onImagesReady(loading)).toEqual(showing(market, true));
  });

  it('leaves the curtain closed when the GM has it closed', () => {
    const closed = playerStage({ curtainOpen: false });

    expect(onImagesReady(onStage(NO_STAGE, closed))).toEqual(showing(closed, false));
  });
});

describe('the same scene', () => {
  it('shows a curtain move at once', () => {
    const closed = { ...market, curtainOpen: false };

    expect(onStage(showing(market), closed)).toEqual(showing(closed, false));
    expect(onStage(showing(closed), market)).toEqual(showing(market, true));
  });

  it('shows a change to what is on stage at once', () => {
    const emptier = { ...market, objects: [] };

    expect(onStage(showing(market), emptier)).toEqual(showing(emptier));
  });
});

describe('another scene', () => {
  it('closes the curtain on the old scene, loads the new one, then opens on it', () => {
    const closing = onStage(showing(market), cellar);
    expect(closing).toEqual({
      step: 'closing',
      view: { stage: market, curtainOpen: false },
      next: cellar,
    });

    const loading = onCurtainClosed(closing);
    expect(loading).toEqual({
      step: 'loading',
      view: { stage: market, curtainOpen: false },
      next: cellar,
    });

    expect(onImagesReady(loading)).toEqual(showing(cellar, true));
  });

  it('skips the wait when the curtain is already closed', () => {
    const behindCurtain = showing(market, false);

    expect(onStage(behindCurtain, cellar)).toEqual({
      step: 'loading',
      view: { stage: market, curtainOpen: false },
      next: cellar,
    });
  });

  it('counts the same scene loaded again as a change of scene', () => {
    const again = { ...market, sceneLoad: 2 };

    expect(onStage(showing(market), again).step).toBe('closing');
  });

  it('counts a new session as a change of scene, even with the same load count', () => {
    const nextNight = playerStage({ session: { ...SESSION, id: crypto.randomUUID() } });

    expect(onStage(showing(market), nextNight).step).toBe('closing');
  });

  it('ends on the newest stage when more arrive mid-change', () => {
    const cellarClosed = { ...cellar, curtainOpen: false };
    const attic = playerStage({ sceneLoad: 3 });

    const closing = onStage(onStage(showing(market), cellar), cellarClosed);
    expect(closing).toMatchObject({ step: 'closing', next: cellarClosed });

    const loading = onStage(onCurtainClosed(closing), attic);
    expect(loading).toMatchObject({ step: 'loading', next: attic });
    expect(loading.view?.stage).toBe(market);

    expect(onImagesReady(loading)).toEqual(showing(attic, true));
  });
});

describe('waits that are over out of turn', () => {
  it('ignores them', () => {
    const idle = showing(market);
    const closing = onStage(idle, cellar);

    expect(onCurtainClosed(idle)).toBe(idle);
    expect(onImagesReady(idle)).toBe(idle);
    // The images may not show before the curtain has closed.
    expect(onImagesReady(closing)).toBe(closing);
    expect(onCurtainClosed(NO_STAGE)).toBe(NO_STAGE);
  });
});
