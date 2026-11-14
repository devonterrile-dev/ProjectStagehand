/**
 * The front curtain's measurements (F3.1). Pure numbers: `Curtain` draws them.
 *
 * The curtain is two halves, each fixed at its outer edge just outside the opening and scaled
 * toward that edge as it opens.
 */
import { OPENING } from './dimensions';

/**
 * How much of the opening's width the open curtain still covers, both gathered halves
 * together: closed is 1, gone entirely would be 0.
 */
export const CURTAIN_OPEN_COVER = 0.25;

/** Each half reaches a little past the middle, so the closed curtain has no gap. */
export const CURTAIN_PANEL_WIDTH = OPENING.width / 2 + 0.04;

/** How far outside the opening each half is fixed. */
export const CURTAIN_SIDE_INSET = 0.03;

/** The share of the opening's width both halves cover when each is scaled to `scale`. */
export function curtainCover(scale: number): number {
  const inside = CURTAIN_PANEL_WIDTH * scale - CURTAIN_SIDE_INSET;
  return Math.min(1, Math.max(0, (2 * inside) / OPENING.width));
}

/** The scale of each half when the curtain is open: it covers `CURTAIN_OPEN_COVER`. */
export const CURTAIN_OPEN_SCALE =
  ((OPENING.width * CURTAIN_OPEN_COVER) / 2 + CURTAIN_SIDE_INSET) / CURTAIN_PANEL_WIDTH;
