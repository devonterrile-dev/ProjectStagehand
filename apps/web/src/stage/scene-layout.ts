/**
 * Where a scene's cutouts stand in the theater (F3.2). Pure numbers, no Three.js.
 */
import type { StageCutout } from '@/lib/scenes';

import { openingToWorld, WORLD_UNITS_PER_PIXEL, type Point3 } from './dimensions';

/**
 * Each object stands this much nearer the front than the one before it in the scene's list.
 * Two cutouts on the same depth tick then never flicker through each other, and the later one
 * is in front. Far smaller than the gap between two ticks, even for a full theater.
 */
export const LIST_NUDGE = 0.002;

/**
 * The top of a lowered puppet waits this far below the opening's bottom edge: deep enough that
 * the camera, which looks slightly down into the theater, can't see it on the back ticks.
 */
export const LOWERED_GAP = 0.3;

/** How tall a cutout stands, in world units. */
export function cutoutHeight(cutout: Pick<StageCutout, 'height' | 'scale'>): number {
  return cutout.height * WORLD_UNITS_PER_PIXEL * cutout.scale;
}

/** Where the bottom center of the `index`-th cutout of a scene goes. */
export function cutoutPosition(
  cutout: Pick<StageCutout, 'across' | 'up' | 'depthTick' | 'height' | 'scale' | 'lowered'>,
  index: number,
): Point3 {
  const [x, y, z] = openingToWorld(cutout.across, cutout.up, cutout.depthTick);
  return [x, cutout.lowered ? -(cutoutHeight(cutout) + LOWERED_GAP) : y, z + index * LIST_NUDGE];
}
