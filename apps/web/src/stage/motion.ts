/**
 * Puppet motion (F3.7, governance §12 "Puppet motion", D-55): idle sway, the talking rise and
 * brighten, and the preset emotes, as plain numbers over time. `Cutout` applies them each
 * frame; nothing here touches Three.js, so every pose can be tested.
 *
 * An emote is an offset from where the puppet stands, turning about the bottom center of the
 * cutout, where the stick holds it. Every one starts and ends at rest, so it never jumps.
 */
import type { Emote } from '@stagehand/shared';

/** The idle sway on the stick: a small turn about the puppeteer's hand, back and forth. */
export const SWAY = { angle: 0.035, speed: 1.3 } as const;

/** How far the sway has turned at `seconds`, starting at `phase` radians. */
export function swayAngle(seconds: number, phase: number): number {
  return Math.sin(seconds * SWAY.speed + phase) * SWAY.angle;
}

/**
 * Where in the sway a puppet starts, from its id: the same in every browser and every frame,
 * and different from puppet to puppet, so they don't sway in step. From 0 to 2π.
 */
export function phaseOf(id: string): number {
  let hash = 0;
  for (let index = 0; index < id.length; index += 1) {
    hash = (Math.imul(hash, 31) + id.charCodeAt(index)) >>> 0;
  }
  return (hash / 2 ** 32) * 2 * Math.PI;
}

/**
 * Walking (F5.4): while a transition scene plays, a puppet that travels with the party steps up
 * and down on its stick in place of the sway: `lift` world units at the top of each step,
 * `steps` steps a second.
 */
export const WALK = { lift: 0.035, steps: 1.8 } as const;

/**
 * How high a walking puppet is lifted at `seconds`, from 0 (foot down) to `WALK.lift`: a bounce
 * that touches down at each step. `phase` (radians) keeps puppets out of step.
 */
export function walkLift(seconds: number, phase: number): number {
  return Math.abs(Math.sin(seconds * WALK.steps * Math.PI + phase)) * WALK.lift;
}

/**
 * Talking: the puppet rises this far (world units) and its colors brighten by this share, eased
 * in and out at `speed` (`MathUtils.damp`) as the voice starts and stops.
 */
export const TALK = { lift: 0.06, brighten: 0.3, speed: 10 } as const;

/** An offset from rest: across, up, toward the audience, and turns about each axis (radians). */
export interface Pose {
  x: number;
  y: number;
  z: number;
  /** Forward, toward the audience, is positive. */
  rx: number;
  ry: number;
  rz: number;
}

export const REST: Pose = { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 };

/** How long each emote plays, in seconds. */
export const EMOTE_SECONDS: Record<Emote, number> = {
  'look-around': 1.6,
  hop: 0.6,
  nod: 0.8,
  shake: 0.8,
  shiver: 1.2,
  'lean-in': 1.4,
  bow: 1.4,
  spin: 0.9,
  droop: 1.8,
  wave: 1.4,
};

const TAU = 2 * Math.PI;

function smoothstep(from: number, to: number, value: number): number {
  const t = Math.min(1, Math.max(0, (value - from) / (to - from)));
  return t * t * (3 - 2 * t);
}

/** 0 → 1 → 0 over the emote, easing in over the first `ease` of it and out over the last. */
function held(u: number, ease: number): number {
  return smoothstep(0, ease, u) * (1 - smoothstep(1 - ease, 1, u));
}

/** A single rise and fall over the emote: 0 at both ends, 1 in the middle. */
function arc(u: number): number {
  return Math.sin(Math.PI * u);
}

/** Each emote's pose at `u`, from 0 (start) to 1 (end). */
const POSES: Record<Emote, (u: number) => Partial<Pose>> = {
  // Turns a little to one side, then the other, then back.
  'look-around': (u) => ({ ry: 0.5 * Math.sin(TAU * u) * held(u, 0.15) }),
  hop: (u) => ({ y: 0.14 * 4 * u * (1 - u) }),
  // Tips forward twice.
  nod: (u) => ({ rx: 0.18 * Math.sin(TAU * u) ** 2 }),
  // Angry: quick and sharp from side to side.
  shake: (u) => ({ rz: 0.12 * Math.sin(TAU * 5 * u) * arc(u) }),
  // Scared: a fast, small tremble.
  shiver: (u) => ({
    x: 0.012 * Math.sin(TAU * 14 * u) * arc(u),
    rz: 0.025 * Math.sin(TAU * 11 * u) * arc(u),
  }),
  // Curious: leans toward the audience, holds, and settles back.
  'lean-in': (u) => ({ z: 0.08 * held(u, 0.3), rx: 0.22 * held(u, 0.3) }),
  bow: (u) => ({ rx: 0.55 * held(u, 0.3) }),
  // One whole turn: at the end the cutout faces front again.
  spin: (u) => ({ ry: TAU * smoothstep(0, 1, u) }),
  // Faint: tips over to one side and sinks, then recovers.
  droop: (u) => ({ rz: -0.5 * held(u, 0.25), y: -0.1 * held(u, 0.25) }),
  // Rocks from side to side three times, slower and wider than a shake.
  wave: (u) => ({ rz: 0.14 * Math.sin(TAU * 3 * u) * held(u, 0.1) }),
};

/** The pose `seconds` into an emote; at rest before it starts and once it is over. */
export function emotePose(emote: Emote, seconds: number): Pose {
  const length = EMOTE_SECONDS[emote];
  if (seconds <= 0 || seconds >= length) return REST;
  return { ...REST, ...POSES[emote](seconds / length) };
}
