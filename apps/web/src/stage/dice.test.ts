import { Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';

import {
  d12Faces,
  DIE_SHAPES,
  faceShowing,
  faceUp,
  freeDiceLanded,
  freeDiceSeconds,
  freeDiceTimeline,
  freeDieAt,
  percentileFaces,
  readingOf,
  readingShowing,
  readingUp,
  REROLL_FROM,
  REROLL_SECONDS,
  seeded,
  TOSS_SECONDS,
  tossedAs,
  tossPose,
  type DieKind,
  type Toss,
} from './dice';

const toss: Toss = {
  landing: [0.5, -0.45, 0.6],
  rest: 0.06,
  from: [-0.35, 0.55, 1.1],
  face: 7,
  seed: 'roll-1:hope',
};

describe('a d12', () => {
  it('has twelve faces numbered 1 to 12, opposite faces adding up to 13', () => {
    const faces = d12Faces();
    expect(faces.map((face) => face.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    for (const face of faces) {
      const opposite = faces.find((other) => other.normal.dot(face.normal) < -0.999);
      expect((opposite?.number ?? 0) + face.number).toBe(13);
    }
  });

  it('puts the face asked for on top, however it is turned', () => {
    for (let number = 1; number <= 12; number += 1) {
      expect(faceShowing(faceUp(number))).toBe(number);
      expect(faceShowing(faceUp(number, 2.1))).toBe(number);
      const up = new Vector3(0, 1, 0);
      const face = d12Faces()[number - 1];
      expect(face?.normal.clone().applyQuaternion(faceUp(number, 1)).distanceTo(up)).toBeLessThan(
        1e-9,
      );
    }
  });

  it('refuses a number that is not on it', () => {
    expect(() => faceUp(13)).toThrow(RangeError);
  });
});

describe('a toss', () => {
  it('lands still on its face, resting on the table', () => {
    const end = tossPose(toss, TOSS_SECONDS);
    expect(faceShowing(end.rotation)).toBe(7);
    expect(end.position).toEqual([0.5, -0.45 + 0.06, 0.6]);
    expect(tossPose(toss, TOSS_SECONDS + 5)).toEqual(end);
  });

  it('starts from the hand, above the table', () => {
    const start = tossPose(toss, 0);
    expect(start.position[0]).toBeCloseTo(0.5 - 0.35);
    expect(start.position[1]).toBeCloseTo(-0.45 + 0.06 + 0.55);
    expect(start.position[2]).toBeCloseTo(0.6 + 1.1);
  });

  it('is the same throw in every browser, and another roll throws differently', () => {
    expect(tossPose(toss, 0.4)).toEqual(tossPose({ ...toss }, 0.4));
    const other = tossPose({ ...toss, seed: 'roll-2:hope' }, 0.4);
    expect(other.rotation.equals(tossPose(toss, 0.4).rotation)).toBe(false);
  });

  it('spins on the way', () => {
    const middle = tossPose(toss, TOSS_SECONDS / 3).rotation;
    expect(middle.angleTo(tossPose(toss, TOSS_SECONDS).rotation)).toBeGreaterThan(0.1);
    expect(middle).toBeInstanceOf(Quaternion);
  });
});

describe('seeded', () => {
  it('gives the same numbers for the same seed, between 0 and 1', () => {
    const a = seeded('x');
    const b = seeded('x');
    const first = [a(), a(), a()];
    expect([b(), b(), b()]).toEqual(first);
    expect(first.every((n) => n >= 0 && n < 1)).toBe(true);
  });
});

describe('the dice of the dice tray (F4.2)', () => {
  const labels = (kind: DieKind) => DIE_SHAPES[kind].readings.map((reading) => reading.label);
  const range = (from: number, to: number) =>
    Array.from({ length: to - from + 1 }, (_, i) => String(from + i));

  it('has every number once on each die', () => {
    expect(labels('d4')).toEqual(range(1, 4));
    expect(labels('d6')).toEqual(range(1, 6));
    expect(labels('d8')).toEqual(range(1, 8));
    expect(labels('d10')).toEqual(range(1, 10));
    expect(labels('d12')).toEqual(range(1, 12));
    expect(labels('d20')).toEqual(range(1, 20));
    expect(labels('d10tens')).toEqual(['00', '10', '20', '30', '40', '50', '60', '70', '80', '90']);
    expect(labels('d10ones')).toEqual(range(0, 9));
  });

  it('puts opposite faces adding up, as on real dice', () => {
    for (const kind of ['d6', 'd8', 'd10', 'd12', 'd20'] as const) {
      const { readings } = DIE_SHAPES[kind];
      for (const reading of readings) {
        const opposite = readings.find((other) => other.direction.dot(reading.direction) < -0.999);
        expect(Number(opposite?.label) + Number(reading.label), kind).toBe(readings.length + 1);
      }
    }
  });

  it('keeps the d12 as it was: the same faces in the same places', () => {
    const faces = d12Faces();
    DIE_SHAPES.d12.readings.forEach((reading, i) => {
      expect(reading.direction.distanceTo(faces[i]?.normal ?? new Vector3())).toBeLessThan(1e-9);
    });
  });

  it('shows whatever it is turned to, on every die', () => {
    for (const shape of Object.values(DIE_SHAPES)) {
      shape.readings.forEach((_, index) => {
        expect(readingShowing(shape, readingUp(shape, index, 1.3)), shape.kind).toBe(index);
      });
    }
  });

  it('makes the d10 of ten flat faces, with a label on each', () => {
    // Faces that weren't flat would split into twenty triangles' worth of normals.
    expect(DIE_SHAPES.d10.readings).toHaveLength(10);
    expect(DIE_SHAPES.d10.spots).toHaveLength(10);
  });

  it('reads a d4 by the corner on top, printed near that corner on each of its three faces', () => {
    const d4 = DIE_SHAPES.d4;
    expect(d4.spots).toHaveLength(12);
    for (let reading = 0; reading < 4; reading += 1) {
      const spots = d4.spots.filter((spot) => spot.reading === reading);
      expect(spots).toHaveLength(3);
      for (const spot of spots) {
        expect(spot.upward.dot(d4.readings[reading]?.direction ?? new Vector3())).toBeGreaterThan(
          0,
        );
      }
    }
    // It lies on the face opposite the corner on top: a third of the way to that corner.
    expect(d4.rest).toBeCloseTo(1 / 3);
  });

  it('rests each die on a face', () => {
    expect(DIE_SHAPES.d6.rest).toBeCloseTo(1 / Math.sqrt(3));
    expect(DIE_SHAPES.d8.rest).toBeCloseTo(1 / Math.sqrt(3));
    for (const shape of Object.values(DIE_SHAPES)) {
      expect(shape.rest, shape.kind).toBeGreaterThan(0.3);
      expect(shape.rest, shape.kind).toBeLessThan(1);
    }
  });

  it('splits a d% result into the tens and ones dice, 100 being 00 and 0', () => {
    expect(percentileFaces(1)).toEqual({ tens: '00', ones: '1' });
    expect(percentileFaces(10)).toEqual({ tens: '10', ones: '0' });
    expect(percentileFaces(55)).toEqual({ tens: '50', ones: '5' });
    expect(percentileFaces(100)).toEqual({ tens: '00', ones: '0' });
  });

  it('tosses a result as its die, or as the two percentile dice', () => {
    expect(tossedAs(20, 14)).toEqual([
      { shape: DIE_SHAPES.d20, reading: readingOf(DIE_SHAPES.d20, '14') },
    ]);
    expect(
      tossedAs(100, 37).map((die) => [die.shape.kind, die.shape.readings[die.reading]?.label]),
    ).toEqual([
      ['d10tens', '30'],
      ['d10ones', '7'],
    ]);
    expect(() => readingOf(DIE_SHAPES.d6, '7')).toThrow(RangeError);
  });

  it('tosses the first die whole, then rerolls it quickly for each further result', () => {
    expect(freeDiceTimeline(3)).toEqual([
      { start: 0, seconds: TOSS_SECONDS },
      { start: TOSS_SECONDS, seconds: REROLL_SECONDS },
      { start: TOSS_SECONDS + REROLL_SECONDS, seconds: REROLL_SECONDS },
    ]);
    expect(freeDiceSeconds(1)).toBe(TOSS_SECONDS);
    expect(freeDiceSeconds(20)).toBeCloseTo(TOSS_SECONDS + 19 * REROLL_SECONDS);
    expect(freeDiceSeconds(0)).toBe(0);
    expect(freeDiceLanded(3, TOSS_SECONDS - 0.01)).toBe(0);
    expect(freeDiceLanded(3, TOSS_SECONDS)).toBe(1);
    expect(freeDiceLanded(3, freeDiceSeconds(3))).toBe(3);
    expect(freeDieAt(3, 0)).toBe(0);
    expect(freeDieAt(3, TOSS_SECONDS + 0.1)).toBe(1);
    expect(freeDieAt(3, 99)).toBe(2);
  });

  it('lands a reroll hop exactly on its face, where it lay', () => {
    const hop: Toss = {
      landing: [0.1, -0.45, 0.6],
      rest: 0.05,
      from: REROLL_FROM,
      face: readingOf(DIE_SHAPES.d20, '17') + 1,
      seed: 'free-1:2',
      shape: DIE_SHAPES.d20,
      seconds: REROLL_SECONDS,
    };
    const end = tossPose(hop, REROLL_SECONDS);
    expect(DIE_SHAPES.d20.readings[readingShowing(DIE_SHAPES.d20, end.rotation)]?.label).toBe('17');
    expect(end.position).toEqual([0.1, -0.45 + 0.05, 0.6]);
    expect(tossPose(hop, 0).position[1]).toBeCloseTo(-0.45 + 0.05 + 0.22);
  });
});
