/**
 * The dice on the table: the two d12s of an action roll (F3.6, governance §9 and §12, D-54) and
 * the dice of a free roll (F4.2, D-60). Which face shows which number, the pose that puts a
 * number on top, and a scripted toss that lands on the server's numbers. No physics: the dice
 * only look rolled. The server's roll is the real one.
 *
 * The toss is worked out from the roll's id, so every browser at the table sees the same throw.
 * Three.js maths and geometry only, no drawing, so it runs in tests.
 */
import type { FreeDie } from '@stagehand/shared';
import {
  BoxGeometry,
  BufferGeometry,
  DodecahedronGeometry,
  Float32BufferAttribute,
  IcosahedronGeometry,
  OctahedronGeometry,
  Quaternion,
  TetrahedronGeometry,
  Vector3,
} from 'three';

import type { Point3 } from './dimensions';

/** How long a toss takes, in seconds, from leaving the hand to lying still. */
export const TOSS_SECONDS = 1.6;
/** How long a reroll takes (F4.2): the die hops up, spins and lands again where it lay. */
export const REROLL_SECONDS = 0.8;
/** Where a reroll hops from, relative to where it lands: straight up. */
export const REROLL_FROM: Point3 = [0, 0.22, 0];

export interface DieFace {
  /** 1 to 12. Opposite faces add up to 13, as on a real d12. */
  number: number;
  /** Outward, unit length. */
  normal: Vector3;
  /** The middle of the face. */
  center: Vector3;
}

const UP = new Vector3(0, 1, 0);

/** A flat face of a solid: its outward normal, middle, corners and edges. */
interface Face {
  normal: Vector3;
  center: Vector3;
  corners: Vector3[];
  /** The face's outline, as pairs of corners. */
  edges: [Vector3, Vector3][];
}

/** The flat faces of a solid: triangles sharing a normal make one face. */
function facesOf(source: BufferGeometry): Face[] {
  const geometry = source.index === null ? source : source.toNonIndexed();
  const position = geometry.getAttribute('position');
  const groups: { normal: Vector3; triangles: [Vector3, Vector3, Vector3][] }[] = [];
  for (let i = 0; i < position.count; i += 3) {
    const a = new Vector3().fromBufferAttribute(position, i);
    const b = new Vector3().fromBufferAttribute(position, i + 1);
    const c = new Vector3().fromBufferAttribute(position, i + 2);
    const normal = new Vector3().subVectors(c, b).cross(new Vector3().subVectors(a, b)).normalize();
    // Outward, whichever way the triangle was wound.
    const middle = a.clone().add(b).add(c);
    if (normal.dot(middle) < 0) normal.negate();
    let group = groups.find((entry) => entry.normal.dot(normal) > 0.999);
    if (group === undefined) {
      group = { normal, triangles: [] };
      groups.push(group);
    }
    group.triangles.push([a, b, c]);
  }
  if (geometry !== source) geometry.dispose();

  const key = (point: Vector3) =>
    point
      .toArray()
      .map((n) => n.toFixed(5))
      .join(',');
  return groups.map(({ normal, triangles }) => {
    const corners = new Map<string, Vector3>();
    const edgeCount = new Map<string, { pair: [Vector3, Vector3]; count: number }>();
    for (const [a, b, c] of triangles) {
      for (const [p, q] of [
        [a, b],
        [b, c],
        [c, a],
      ] as const) {
        corners.set(key(p), p);
        const edge = [key(p), key(q)].sort().join('|');
        const seen = edgeCount.get(edge);
        if (seen === undefined) edgeCount.set(edge, { pair: [p, q], count: 1 });
        else seen.count += 1;
      }
    }
    const points = [...corners.values()];
    const center = new Vector3();
    for (const point of points) center.add(point);
    center.divideScalar(points.length);
    // An edge inside the face is shared by two of its triangles; the outline isn't.
    const edges = [...edgeCount.values()].filter((e) => e.count === 1).map((e) => e.pair);
    return { normal, center, corners: points, edges };
  });
}

/** Faces in a fixed order: from the top down, then by x and z. */
function inOrder<T extends { normal: Vector3 }>(items: readonly T[]): T[] {
  return [...items].sort(
    (p, q) => q.normal.y - p.normal.y || p.normal.x - q.normal.x || p.normal.z - q.normal.z,
  );
}

/**
 * Numbers faces 0 to n − 1 so that opposite faces add up to n − 1, in a fixed order: the same
 * die always has the same numbers in the same places.
 */
function pairNumbers(faces: readonly Face[]): Map<Face, number> {
  const numbers = new Map<Face, number>();
  let next = 0;
  for (const face of inOrder(faces)) {
    if (numbers.has(face)) continue;
    const opposite = faces.find((entry) => entry.normal.dot(face.normal) < -0.999);
    if (opposite === undefined) throw new Error('A die face has no opposite');
    numbers.set(face, next);
    numbers.set(opposite, faces.length - 1 - next);
    next += 1;
  }
  return numbers;
}

/**
 * The faces of a d12 of this radius (to its corners), built as Three.js builds its
 * dodecahedron: twelve pentagons, each three triangles that share a normal.
 */
export function d12Faces(radius = 1): DieFace[] {
  const geometry = new DodecahedronGeometry(radius, 0);
  const faces = facesOf(geometry);
  geometry.dispose();
  if (faces.length !== 12) throw new Error(`A d12 has 12 faces, not ${String(faces.length)}`);
  const numbers = pairNumbers(faces);
  return faces
    .map((face) => ({
      number: (numbers.get(face) ?? 0) + 1,
      normal: face.normal,
      center: face.center,
    }))
    .sort((p, q) => p.number - q.number);
}

/**
 * A ten-sided die (a pentagonal trapezohedron) of this radius: a point at the top and the bottom,
 * and a ring of ten corners between, half a little above the middle and half a little below.
 * Their heights keep each four-cornered face flat.
 */
export function d10Geometry(radius = 1): BufferGeometry {
  const ring = Math.cos(Math.PI / 5);
  const lift = (1 - ring) / (1 + ring);
  const top = new Vector3(0, 1, 0);
  const bottom = new Vector3(0, -1, 0);
  const at = (step: number, y: number) =>
    new Vector3(Math.cos((step * Math.PI) / 5), y, Math.sin((step * Math.PI) / 5));
  const positions: number[] = [];
  // Wound to face outward, as Three.js draws only a triangle's front.
  const triangle = (a: Vector3, b: Vector3, c: Vector3) => {
    const front = new Vector3().subVectors(b, a).cross(new Vector3().subVectors(c, a));
    const outward = front.dot(a.clone().add(b).add(c)) > 0;
    for (const point of outward ? [a, b, c] : [a, c, b]) positions.push(point.x, point.y, point.z);
  };
  for (let k = 0; k < 5; k += 1) {
    const high = (n: number) => at(2 * n, lift);
    const low = (n: number) => at(2 * n + 1, -lift);
    // A face from the top point: two high corners and the low one between them, and the same
    // from the bottom point.
    triangle(top, high(k + 1), low(k));
    triangle(top, low(k), high(k));
    triangle(bottom, low(k), high(k + 1));
    triangle(bottom, high(k + 1), low(k + 1));
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.scale(radius, radius, radius);
  geometry.computeVertexNormals();
  return geometry;
}

/** The dice the table draws: the d12s of action rolls, and every die of the dice tray. */
export type DieKind = 'd4' | 'd6' | 'd8' | 'd10' | 'd10tens' | 'd10ones' | 'd12' | 'd20';

/** Where a number sits on a die: a small square on a face, turned so the number reads upright. */
export interface LabelSpot {
  /** Which reading's label it shows. */
  reading: number;
  center: Vector3;
  /** Outward. */
  normal: Vector3;
  /** Along the face, the way the number's top points. */
  upward: Vector3;
  /** Half the square's side. */
  half: number;
}

export interface DieShape {
  kind: DieKind;
  /** The die's body, for a die of this radius (to its corners). */
  geometry: (radius: number) => BufferGeometry;
  /** What the die can show, in order: a label, and the way that points up when it shows. */
  readings: { label: string; direction: Vector3 }[];
  /** How high its middle lies above the table, for a radius of 1. */
  rest: number;
  /** Where each label is printed, for a radius of 1. */
  spots: LabelSpot[];
}

/** The shortest way from a face's middle to its outline. */
function inset(face: Face): number {
  let nearest = Infinity;
  for (const [p, q] of face.edges) {
    const along = new Vector3().subVectors(q, p);
    const t = Math.max(
      0,
      Math.min(1, new Vector3().subVectors(face.center, p).dot(along) / along.lengthSq()),
    );
    nearest = Math.min(nearest, p.clone().addScaledVector(along, t).distanceTo(face.center));
  }
  return nearest;
}

/** A label square's `upward`: whatever is most nearly up along the face, for a steady look. */
function upwardOn(normal: Vector3): Vector3 {
  const side = new Vector3(1, 0, 0);
  const across = new Vector3()
    .crossVectors(Math.abs(normal.y) < 0.9 ? UP : side, normal)
    .normalize();
  return new Vector3().crossVectors(normal, across);
}

const LIFT = 0.0008;

/** A die that shows the face on top: each face has one label, in its middle. */
function faceShape(
  kind: DieKind,
  geometry: (radius: number) => BufferGeometry,
  label: (number: number) => string,
  size: (face: Face) => number,
): DieShape {
  const body = geometry(1);
  const faces = facesOf(body);
  body.dispose();
  const numbers = pairNumbers(faces);
  const ordered = [...faces].sort((p, q) => (numbers.get(p) ?? 0) - (numbers.get(q) ?? 0));
  return {
    kind,
    geometry,
    readings: ordered.map((face, index) => ({ label: label(index), direction: face.normal })),
    rest: Math.min(...faces.map((face) => face.center.dot(face.normal))),
    spots: ordered.map((face, index) => ({
      reading: index,
      center: face.center.clone().addScaledVector(face.normal, LIFT),
      normal: face.normal,
      upward: upwardOn(face.normal),
      half: size(face),
    })),
  };
}

/**
 * A d4 (F4.2): it lies on a face with a corner up, and shows the number of that corner, as a
 * real d4 does. Each face carries the numbers of its three corners, each near its corner.
 */
function d4Shape(): DieShape {
  const geometry = (radius: number) => new TetrahedronGeometry(radius, 0);
  const body = geometry(1);
  const faces = facesOf(body);
  body.dispose();
  const corners: Vector3[] = [];
  for (const face of faces) {
    for (const corner of face.corners) {
      if (!corners.some((known) => known.distanceTo(corner) < 1e-4)) corners.push(corner);
    }
  }
  const ordered = inOrder(
    corners.map((corner) => ({ corner, normal: corner.clone().normalize() })),
  );
  const spots: LabelSpot[] = [];
  for (const face of faces) {
    const half = inset(face) * 0.42;
    for (const corner of face.corners) {
      const reading = ordered.findIndex((entry) => entry.corner.distanceTo(corner) < 1e-4);
      const toward = new Vector3().subVectors(corner, face.center);
      spots.push({
        reading,
        center: face.center.clone().addScaledVector(toward, 0.5).addScaledVector(face.normal, LIFT),
        normal: face.normal,
        upward: toward.normalize(),
        half,
      });
    }
  }
  return {
    kind: 'd4',
    geometry,
    readings: ordered.map((entry, index) => ({
      label: String(index + 1),
      direction: entry.normal,
    })),
    rest: Math.min(...faces.map((face) => face.center.dot(face.normal))),
    spots,
  };
}

/** A square with its corners on a sphere of `radius`. */
const cube = (radius: number) => {
  const side = (2 * radius) / Math.sqrt(3);
  return new BoxGeometry(side, side, side);
};

const fromOne = (index: number) => String(index + 1);
const sized = (share: number) => (face: Face) => inset(face) * share;

function buildShapes(): Record<DieKind, DieShape> {
  const d12 = faceShape(
    'd12',
    (r) => new DodecahedronGeometry(r, 0),
    fromOne,
    (face) =>
      // As the d12s have always been drawn (F3.6).
      face.center.length() * 0.45,
  );
  return {
    d4: d4Shape(),
    d6: faceShape('d6', cube, fromOne, sized(0.7)),
    d8: faceShape('d8', (r) => new OctahedronGeometry(r, 0), fromOne, sized(0.85)),
    d10: faceShape('d10', d10Geometry, fromOne, sized(0.85)),
    d10tens: faceShape('d10tens', d10Geometry, (i) => String(i * 10).padStart(2, '0'), sized(0.95)),
    d10ones: faceShape('d10ones', d10Geometry, (i) => String(i), sized(0.85)),
    d12,
    d20: faceShape('d20', (r) => new IcosahedronGeometry(r, 0), fromOne, sized(0.85)),
  };
}

/** Every die the table draws, by kind. */
export const DIE_SHAPES: Readonly<Record<DieKind, DieShape>> = buildShapes();

/** The reading of a die that shows `label`. */
export function readingOf(shape: DieShape, label: string): number {
  const index = shape.readings.findIndex((reading) => reading.label === label);
  if (index < 0) throw new RangeError(`A ${shape.kind} has no ${label}`);
  return index;
}

/** The rotation that puts reading `index` up, turned `yaw` radians about the vertical. */
export function readingUp(shape: DieShape, index: number, yaw = 0): Quaternion {
  const reading = shape.readings[index];
  if (reading === undefined)
    throw new RangeError(`A ${shape.kind} has no reading ${String(index)}`);
  const toUp = new Quaternion().setFromUnitVectors(reading.direction, UP);
  return new Quaternion().setFromAxisAngle(UP, yaw).multiply(toUp);
}

/** The reading pointing up in a pose: what a die shows. */
export function readingShowing(shape: DieShape, rotation: Quaternion): number {
  let best = 0;
  let height = -Infinity;
  shape.readings.forEach((reading, index) => {
    const y = reading.direction.clone().applyQuaternion(rotation).y;
    if (y > height) {
      height = y;
      best = index;
    }
  });
  return best;
}

/** The rotation that puts `number` face up on a d12, turned `yaw` radians about the vertical. */
export function faceUp(number: number, yaw = 0): Quaternion {
  if (!Number.isInteger(number) || number < 1 || number > 12) {
    throw new RangeError(`Not a d12 face: ${String(number)}`);
  }
  return readingUp(DIE_SHAPES.d12, number - 1, yaw);
}

/** The face pointing up in a pose of a d12: the number it shows. */
export function faceShowing(rotation: Quaternion): number {
  return readingShowing(DIE_SHAPES.d12, rotation) + 1;
}

/** A d% result, 1 to 100, as the tens die and the ones die show it: 100 is 00 and 0. */
export function percentileFaces(result: number): { tens: string; ones: string } {
  const value = result % 100;
  return {
    tens: String(Math.floor(value / 10) * 10).padStart(2, '0'),
    ones: String(value % 10),
  };
}

/** What a free roll's result is tossed as: one die, or the two percentile dice (d%, F4.2). */
export function tossedAs(die: FreeDie, result: number): { shape: DieShape; reading: number }[] {
  if (die === 100) {
    const { tens, ones } = percentileFaces(result);
    return [
      { shape: DIE_SHAPES.d10tens, reading: readingOf(DIE_SHAPES.d10tens, tens) },
      { shape: DIE_SHAPES.d10ones, reading: readingOf(DIE_SHAPES.d10ones, ones) },
    ];
  }
  const shape = DIE_SHAPES[`d${String(die)}` as DieKind];
  return [{ shape, reading: readingOf(shape, String(result)) }];
}

/**
 * When each die of a free roll is tossed (F4.2): the first with a whole toss, then the same die
 * hops again for each further result as soon as it lands. Seconds from the start.
 */
export function freeDiceTimeline(count: number): { start: number; seconds: number }[] {
  return Array.from({ length: count }, (_, i) => ({
    start: i === 0 ? 0 : TOSS_SECONDS + (i - 1) * REROLL_SECONDS,
    seconds: i === 0 ? TOSS_SECONDS : REROLL_SECONDS,
  }));
}

/** How long a free roll of `count` dice takes to play. */
export function freeDiceSeconds(count: number): number {
  return count <= 0 ? 0 : TOSS_SECONDS + (count - 1) * REROLL_SECONDS;
}

/** How many of a free roll's dice have landed `seconds` after it began. */
export function freeDiceLanded(count: number, seconds: number): number {
  return freeDiceTimeline(count).filter((step) => step.start + step.seconds <= seconds).length;
}

/** Which die of a free roll is in the air, or lying last, `seconds` after it began. */
export function freeDieAt(count: number, seconds: number): number {
  const timeline = freeDiceTimeline(count);
  let current = 0;
  timeline.forEach((step, index) => {
    if (seconds >= step.start) current = index;
  });
  return current;
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
  /** The number it shows at the end: 1 to 12 on a d12, or the reading's place + 1 on `shape`. */
  face: number;
  /** The roll's id and which die: the same for every browser. */
  seed: string;
  /** The die; a d12 when left out. */
  shape?: DieShape;
  /** How long the toss takes; `TOSS_SECONDS` when left out. */
  seconds?: number;
}

const easeOut = (p: number) => 1 - (1 - p) ** 3;

/**
 * The die's pose `seconds` into a toss: it flies in from `from`, bounces twice, and lies still
 * showing `face` once the toss is over. Spinning slows as it lands, so it ends exactly on the
 * face, turned by a yaw of its own.
 */
export function tossPose(toss: Toss, seconds: number): DiePose {
  const random = seeded(toss.seed);
  const yaw = random() * Math.PI * 2;
  const axis = new Vector3(random() - 0.5, random() - 0.5, random() - 0.5).normalize();
  const spin = (2 + random() * 2) * Math.PI * 2;
  const final = readingUp(toss.shape ?? DIE_SHAPES.d12, toss.face - 1, yaw);

  const length = toss.seconds ?? TOSS_SECONDS;
  const p = Math.min(1, Math.max(0, seconds / length));
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
