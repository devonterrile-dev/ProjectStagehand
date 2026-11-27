import { z } from 'zod';

/**
 * The stage (Phase 3, governance §12, D-36): the values the browser's theater and the server's
 * scene checks must agree on.
 */

/** Fixed distances from the front of the theater (0) to the back (9). */
export const DEPTH_TICKS = 10;

/** Most props and puppets in the theater at once (§12 performance budget). */
export const STAGE_MAX_OBJECTS = 30;

/** Most players in one live session, besides the GM (§3). Each brings one PC puppet. */
export const SESSION_MAX_PLAYERS = 6;

/** A depth tick: a whole number from 0 (front) to 9 (back). */
export const depthTickSchema = z
  .int()
  .min(0)
  .max(DEPTH_TICKS - 1);
export type DepthTick = z.infer<typeof depthTickSchema>;

/**
 * Travel (F5.4, governance §12 "Transition scenes"): while a transition scene plays, its
 * backdrop scrolls right to left and props and stationary NPCs pass by. Distance is measured in
 * opening widths, so 1 is one whole backdrop: the backdrop is exactly as wide as the opening.
 */

/** How fast a transition scene travels, in opening widths a second: one backdrop in 12 s (19.29). */
export const TRAVEL_SPEED = 1 / 12;

/**
 * How far a passing prop or stationary NPC travels before it leaves (F5.4): it comes in from
 * fully behind the right wall and leaves once its left side reaches the left edge, which is one
 * opening width whatever its size.
 */
export const PASS_SPAN = 1;

/** A transition scene's travel clock: how far it had gone, and since when it has been playing. */
export interface TravelClock {
  /** The distance travelled before `since`, in opening widths. */
  distance: number;
  /** When it started playing, in milliseconds; null while paused. */
  since: number | null;
}

/** How far the scene has travelled at `now` (milliseconds), in opening widths. */
export function travelDistance(clock: TravelClock, now: number): number {
  if (clock.since === null) return clock.distance;
  return clock.distance + (Math.max(0, now - clock.since) / 1000) * TRAVEL_SPEED;
}

/** Whether a pass that began at `passFrom` is over at `distance`. */
export function passOver(passFrom: number, distance: number): boolean {
  return distance - passFrom >= PASS_SPAN;
}

/**
 * When (milliseconds) a pass that began at `passFrom` ends, or null while paused; `now` when it
 * is already over.
 */
export function passEndsAt(passFrom: number, clock: TravelClock, now: number): number | null {
  if (clock.since === null) return null;
  const left = passFrom + PASS_SPAN - travelDistance(clock, now);
  return now + Math.max(0, (left / TRAVEL_SPEED) * 1000);
}
