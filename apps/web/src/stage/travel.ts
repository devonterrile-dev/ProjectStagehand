/**
 * Travel in a transition scene (F5.4, governance §12 "Transition scenes"), as the theater draws
 * it: the backdrop scrolling in a mirrored loop, props and stationary NPCs passing by, and
 * walking puppets. The server keeps the clock and sends how far it had gone with each stage; a
 * browser anchors that to when the stage arrived and counts on from there while it plays. Pure
 * numbers, no Three.js, except the context the canvas reads them through.
 */
import { passOver, TRAVEL_SPEED, type StageTravel } from '@stagehand/shared';
import { createContext, type RefObject } from 'react';

import { OPENING, WORLD_UNITS_PER_PIXEL } from './dimensions';
import { cutoutHeight, LOWERED_GAP } from './scene-layout';

/** The travel as it arrived: playing or not, the distance then, and when (`performance.now`). */
export interface TravelAnchor {
  playing: boolean;
  /** In opening widths: 1 is one whole backdrop. */
  distance: number;
  /** When it arrived, in milliseconds. */
  at: number;
}

/** Anchors a stage's travel to the moment it arrived. Null for a static scene. */
export function anchorTravel(travel: StageTravel | null, at: number): TravelAnchor | null {
  return travel === null ? null : { ...travel, at };
}

/** How far the scene has travelled at `now` (milliseconds), in opening widths. */
export function distanceAt(anchor: TravelAnchor, now: number): number {
  if (!anchor.playing) return anchor.distance;
  return anchor.distance + (Math.max(0, now - anchor.at) / 1000) * TRAVEL_SPEED;
}

/**
 * The backdrop's texture offset across, for the distance: one opening width is one whole
 * image, and the texture wraps mirrored, so every second copy is flipped and the edges meet.
 */
export function backdropOffset(distance: number): number {
  // Kept small so the number stays exact over a long session; the mirrored pattern repeats
  // every two widths.
  return distance % 2;
}

/** Half a cutout's width, in opening widths. */
export function halfWidthOf(cutout: { width: number; scale: number }): number {
  return (cutout.width * WORLD_UNITS_PER_PIXEL * cutout.scale) / 2 / OPENING.width;
}

/**
 * Where a passer's center is across the opening (0 left edge, 1 right edge) at `distance`: it
 * starts fully behind the right wall and slides left with the backdrop, so after one opening
 * width its left side touches the left edge, where it leaves.
 */
export function passAcross(passFrom: number, distance: number, halfWidth: number): number {
  return 1 + halfWidth - (distance - passFrom);
}

/** Whether a pass is over at `distance`: the passer leaves, down or up out of sight. */
export function passEnded(passFrom: number, distance: number): boolean {
  return passOver(passFrom, distance);
}

/**
 * Where a passer goes as it leaves at the left edge, as the y of its bottom center: down
 * through the floor (a prop on a stand, a puppet into the void), or up into the roof for a prop
 * that hangs.
 */
export function leavingY(cutout: {
  mount: 'stick' | 'stand' | 'hang';
  height: number;
  scale: number;
}): number {
  if (cutout.mount === 'hang') return OPENING.height + LOWERED_GAP;
  return -(cutoutHeight(cutout) + LOWERED_GAP);
}

/** The x of an across value: the same as `openingToWorld`, without a depth. */
export function acrossToX(across: number): number {
  return (across - 0.5) * OPENING.width;
}

/**
 * The travel the theater draws from, null for a static scene. A ref, read each frame: a new
 * stage moves the anchor without re-rendering anything in the canvas.
 */
export type TravelRef = RefObject<TravelAnchor | null>;

/** No travel: a static scene, the builder, the stage test until it travels. */
export const NO_TRAVEL: TravelRef = { current: null };

export const TravelContext = createContext<TravelRef>(NO_TRAVEL);
