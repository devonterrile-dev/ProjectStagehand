/**
 * The theater's measurements (F3.1, governance §12, D-36), in world units. Everything on the
 * stage is placed from these, so the camera, the depth ticks and the scene builder (F3.2) can
 * never disagree about where the theater is.
 *
 * The origin is the middle of the bottom edge of the theater's opening, on its front plane:
 * x runs right, y runs up, and the theater goes back along -z. The table and the players are
 * on the +z side.
 */
import { DEPTH_TICKS } from '@stagehand/shared';

/** The opening players look through: 16:9, like the backdrop behind it. */
export const OPENING = { width: 3.2, height: 1.8 } as const;

/** From the front plane back to the back wall, where the backdrop hangs. */
export const THEATER_DEPTH = 1.5;

/** Thickness of the back wall, the side walls and the roof. */
export const WALL_THICKNESS = 0.08;

/**
 * The front of the theater around the opening: a post each side, a beam above, and the apron
 * below that hides the void from the table. It stands in front of the front plane.
 */
export const FRAME = { side: 0.22, top: 0.3, apron: 0.45, thickness: 0.1 } as const;

/** How far the void goes down below the opening: puppets wait in it, out of sight. */
export const VOID_DEPTH = 1.6;

/** The tabletop. Its surface is where the theater's apron ends; it runs toward the players. */
export const TABLE = {
  width: 6.4,
  depth: 4.2,
  thickness: 0.12,
  topY: -FRAME.apron,
} as const;

/** The curtain hangs just behind the front plane, in front of every depth tick. */
export const CURTAIN_Z = -0.05;

/** Tick 0 stands this far behind the front plane. */
export const TICK_FRONT = 0.15;

/** The last tick stops this far short of the back wall. */
export const TICK_BACK_GAP = 0.09;

/** The distance between two neighbouring depth ticks. */
export const TICK_STEP = (THEATER_DEPTH - TICK_FRONT - TICK_BACK_GAP) / (DEPTH_TICKS - 1);

/**
 * World units per pixel of a cutout at scale 1: a cutout 1024 px tall (the tallest there is,
 * D-43) stands half as high as the opening.
 */
export const WORLD_UNITS_PER_PIXEL = (OPENING.height * 0.5) / 1024;

export type Point3 = readonly [x: number, y: number, z: number];

/** The z of a depth tick: 0 is the front, 9 the back. */
export function depthTickZ(tick: number): number {
  if (!Number.isInteger(tick) || tick < 0 || tick >= DEPTH_TICKS) {
    throw new RangeError(`Not a depth tick: ${String(tick)}`);
  }
  return -(TICK_FRONT + tick * TICK_STEP);
}

/**
 * A place inside the theater. `across` runs 0 (left edge of the opening) to 1 (right edge),
 * `up` runs 0 (bottom edge) to 1 (top edge), and `tick` is a depth tick. `up` may go below 0:
 * that is the void, where a lowered puppet waits.
 */
export function openingToWorld(across: number, up: number, tick: number): Point3 {
  return [(across - 0.5) * OPENING.width, up * OPENING.height, depthTickZ(tick)];
}
