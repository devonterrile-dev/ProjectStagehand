import { z } from 'zod';

/**
 * The stage (Phase 3, governance §12, D-36): the values the browser's theater and the server's
 * scene checks must agree on.
 */

/** Fixed distances from the front of the theater (0) to the back (9). */
export const DEPTH_TICKS = 10;

/** Most props and puppets in the theater at once (§12 performance budget). */
export const STAGE_MAX_OBJECTS = 30;

/** A depth tick: a whole number from 0 (front) to 9 (back). */
export const depthTickSchema = z
  .int()
  .min(0)
  .max(DEPTH_TICKS - 1);
export type DepthTick = z.infer<typeof depthTickSchema>;
