/**
 * The two d12s on the table (F3.6, governance §9 and §12, D-54): which face shows which number,
 * the pose that puts a number on top, and a scripted toss that lands on the server's numbers.
 * No physics: the dice only look rolled. The server's roll is the real one.
 *
 * The toss is worked out from the roll's id, so every browser at the table sees the same throw.
 * Three.js maths and geometry only, no drawing, so it runs in tests.
 */
import { DodecahedronGeometry, Quaternion, Vector3 } from 'three';

import type { Point3 } from './dimensions';

/** How long a toss takes, in seconds, from leaving the hand to lying still. */
export const TOSS_SECONDS = 1.6;

export interface DieFace {
  /** 1 to 12. Opposite faces add up to 13, as on a real d12. */
  number: number;
  /** Outward, unit length. */
  normal: Vector3;
  /** The middle of the face. */
  center: Vector3;
}

const UP = new Vector3(0, 1, 0);

/**
 * The faces of a d12 of this radius (to its corners), built as Three.js builds its
 * dodecahedron: twelve pentagons, each three triangles that share a normal.
 */
export function d12Faces(radius = 1): DieFace[] {
  const geometry = new DodecahedronGeometry(radius, 0);
  const position = geometry.getAttribute('position');
  const groups: { normal: Vector3; points: Vector3[] }[] = [];
  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  for (let i = 0; i < position.count; i += 3) {
    a.fromBufferAttribute(position, i);
    b.fromBufferAttribute(position, i + 1);
    c.fromBufferAttribute(position, i + 2);
    const normal = new Vector3().subVectors(c, b).cross(new Vector3().subVectors(a, b)).normalize();
    let group = groups.find((entry) => entry.normal.dot(normal) > 0.999);
    if (group === undefined) {
      group = { normal, points: [] };
      groups.push(group);
    }
    group.points.push(a.clone(), b.clone(), c.clone());
  }
  geometry.dispose();
  if (groups.length !== 12) throw new Error(`A d12 has 12 faces, not ${String(groups.length)}`);

  // Numbered in a fixed order, each with its opposite: 1 and 12, 2 and 11…
  const ordered = [...groups].sort(
    (p, q) => q.normal.y - p.normal.y || p.normal.x - q.normal.x || p.normal.z - q.normal.z,
  );
  const numbers = new Map<(typeof groups)[number], number>();
  let next = 1;
  for (const group of ordered) {
    if (numbers.has(group)) continue;
    const opposite = groups.find((entry) => entry.normal.dot(group.normal) < -0.999);
    if (opposite === undefined) throw new Error('A d12 face has no opposite');
    numbers.set(group, next);
    numbers.set(opposite, 13 - next);
    next += 1;
  }

  return groups
    .map((group) => {
      const center = new Vector3();
      for (const point of group.points) center.add(point);
      center.divideScalar(group.points.length);
      return { number: numbers.get(group) ?? 0, normal: group.normal, center };
    })
    .sort((p, q) => p.number - q.number);
}

const UNIT_FACES = d12Faces(1);

/** The rotation that puts `number` face up, turned `yaw` radians about the vertical. */
export function faceUp(number: number, yaw = 0): Quaternion {
  const face = UNIT_FACES[number - 1];
  if (face === undefined) throw new RangeError(`Not a d12 face: ${String(number)}`);
  const toUp = new Quaternion().setFromUnitVectors(face.normal, UP);
  return new Quaternion().setFromAxisAngle(UP, yaw).multiply(toUp);
}

/** The face pointing up in a pose: the number a die shows. */
export function faceShowing(rotation: Quaternion): number {
  let best = UNIT_FACES[0];
  let height = -Infinity;
  for (const face of UNIT_FACES) {
    const y = face.normal.clone().applyQuaternion(rotation).y;
    if (y > height) {
      height = y;
      best = face;
    }
  }
  return best?.number ?? 0;
}

/** A small, fast random number source from a seed: the same seed, the same numbers. */
export function seeded(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  }
  let state = h >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface DiePose {
  position: Point3;
  rotation: Quaternion;
}

export interface Toss {
  /** Where the die lies at the end, on the table; it rests `rest` above it. */
  landing: Point3;
  rest: number;
  /** Where it leaves the hand, relative to `landing`. */
  from: Point3;
  /** The number it shows at the end. */
  face: number;
  /** The roll's id and which die: the same for every browser. */
  seed: string;
}

const easeOut = (p: number) => 1 - (1 - p) ** 3;

/**
 * The die's pose `seconds` into a toss: it flies in from `from`, bounces twice, and lies still
 * showing `face` from `TOSS_SECONDS` on. Spinning slows as it lands, so it ends exactly on the
 * face, turned by a yaw of its own.
 */
export function tossPose(toss: Toss, seconds: number): DiePose {
  const random = seeded(toss.seed);
  const yaw = random() * Math.PI * 2;
  const axis = new Vector3(random() - 0.5, random() - 0.5, random() - 0.5).normalize();
  const spin = (2 + random() * 2) * Math.PI * 2;
  const final = faceUp(toss.face, yaw);

  const p = Math.min(1, Math.max(0, seconds / TOSS_SECONDS));
  const turned = easeOut(p);
  const rotation = final
    .clone()
    .multiply(new Quaternion().setFromAxisAngle(axis, spin * (1 - turned)));

  const along = easeOut(Math.min(1, p * 1.25));
  const [lx, ly, lz] = toss.landing;
  const [fx, fy, fz] = toss.from;
  // Two bounces, each lower: |cos| hits the table at p = 0.2, 0.6 and 1.
  const bounce = p >= 1 ? 0 : fy * (1 - p) ** 1.6 * Math.abs(Math.cos(2.5 * Math.PI * p));
  return {
    position: [lx + fx * (1 - along), ly + toss.rest + bounce, lz + fz * (1 - along)],
    rotation,
  };
}
