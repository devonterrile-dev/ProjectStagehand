/**
 * Placing by hand in the theater (F3.2c, governance §12 "Placing things in the scene"): from
 * where the pointer is on the screen to a place across and up the opening. Pure numbers, no
 * Three.js: `SceneObjects` and `PlacementProbe` feed it the camera's ray.
 *
 * An object is dragged on its own depth tick: the pointer's ray is cut by the upright plane at
 * that depth, so it works from the locked camera and from the editing camera alike.
 */
import { OPENING, type Point3 } from './dimensions';

/** The line from the camera through the pointer, in world units. */
export interface PointerRay {
  origin: Point3;
  direction: Point3;
}

/** A place in the opening: 0 to 1 across (left to right) and up (bottom to top). */
export interface Place {
  across: number;
  up: number;
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/**
 * Where on the screen the pointer is, as the camera counts it: -1 to 1 across and up, with up
 * positive. `rect` is the canvas's place in the window.
 */
export function pointerNdc(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
): { x: number; y: number } {
  return {
    x: ((clientX - rect.left) / rect.width) * 2 - 1,
    y: -((clientY - rect.top) / rect.height) * 2 + 1,
  };
}

/**
 * Where the ray crosses the upright plane at depth `z`, or null when it never does: it runs
 * alongside the plane, or the plane is behind the camera.
 */
export function rayAtDepth(ray: PointerRay, z: number): { x: number; y: number } | null {
  const [ox, oy, oz] = ray.origin;
  const [dx, dy, dz] = ray.direction;
  if (Math.abs(dz) < 1e-9) return null;
  const distance = (z - oz) / dz;
  if (!Number.isFinite(distance) || distance <= 0) return null;
  return { x: ox + dx * distance, y: oy + dy * distance };
}

/** The place in the opening of a point on a depth plane, kept inside the opening. */
export function placeAt(x: number, y: number): Place {
  return { across: clamp01(x / OPENING.width + 0.5), up: clamp01(y / OPENING.height) };
}

/**
 * Where a dragged cutout's bottom center goes. `grab` is how far from that bottom center the
 * pointer took hold of it, so the cutout doesn't jump to the pointer when the drag starts.
 */
export function dragPlace(
  ray: PointerRay,
  grab: { dx: number; dy: number },
  z: number,
): Place | null {
  const point = rayAtDepth(ray, z);
  return point === null ? null : placeAt(point.x - grab.dx, point.y - grab.dy);
}

/** A press becomes a drag once the pointer has moved this many pixels: a click moves nothing. */
export const DRAG_START_PIXELS = 4;

export function isDrag(
  from: { clientX: number; clientY: number },
  to: { clientX: number; clientY: number },
): boolean {
  return Math.hypot(to.clientX - from.clientX, to.clientY - from.clientY) > DRAG_START_PIXELS;
}
