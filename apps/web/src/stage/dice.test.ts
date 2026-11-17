import { Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';

import { d12Faces, faceShowing, faceUp, seeded, TOSS_SECONDS, tossPose, type Toss } from './dice';

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
