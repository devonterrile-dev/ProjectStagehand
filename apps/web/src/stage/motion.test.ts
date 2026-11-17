import { EMOTES } from '@stagehand/shared';
import { describe, expect, it } from 'vitest';

import { EMOTE_SECONDS, emotePose, phaseOf, REST, SWAY, swayAngle, type Pose } from './motion';

const TAU = 2 * Math.PI;

/** How far a pose is from rest, with a whole turn counted as none. */
function offRest(pose: Pose): number {
  const turn = (angle: number) => Math.abs(Math.atan2(Math.sin(angle), Math.cos(angle)));
  return Math.max(
    Math.abs(pose.x),
    Math.abs(pose.y),
    Math.abs(pose.z),
    turn(pose.rx),
    turn(pose.ry),
    turn(pose.rz),
  );
}

describe('emotes', () => {
  it('has a length for every emote, each a second or two', () => {
    for (const emote of EMOTES) {
      expect(EMOTE_SECONDS[emote]).toBeGreaterThanOrEqual(0.5);
      expect(EMOTE_SECONDS[emote]).toBeLessThanOrEqual(2);
    }
  });

  it('starts and ends every emote at rest, so the puppet never jumps', () => {
    for (const emote of EMOTES) {
      const length = EMOTE_SECONDS[emote];
      expect(emotePose(emote, 0)).toEqual(REST);
      expect(emotePose(emote, length)).toEqual(REST);
      expect(emotePose(emote, length + 5)).toEqual(REST);
      expect(emotePose(emote, -1)).toEqual(REST);
      // Just inside each end it is barely moving yet.
      expect(offRest(emotePose(emote, 0.01)), emote).toBeLessThan(0.03);
      expect(offRest(emotePose(emote, length - 0.01)), emote).toBeLessThan(0.03);
    }
  });

  it('moves the puppet in the middle of every emote', () => {
    for (const emote of EMOTES) {
      const length = EMOTE_SECONDS[emote];
      const most = Math.max(
        ...Array.from({ length: 50 }, (_, step) =>
          offRest(emotePose(emote, ((step + 0.5) / 50) * length)),
        ),
      );
      expect(most, emote).toBeGreaterThan(0.01);
    }
  });

  it('bows forward, toward the audience, and droops to one side and down', () => {
    expect(emotePose('bow', 0.7).rx).toBeGreaterThan(0.4);
    const droop = emotePose('droop', 0.9);
    expect(droop.rz).toBeLessThan(-0.4);
    expect(droop.y).toBeLessThan(0);
    expect(emotePose('hop', 0.3).y).toBeCloseTo(0.14);
    expect(emotePose('spin', 0.45).ry).toBeCloseTo(TAU / 2);
  });
});

describe('sway', () => {
  it('stays within its small angle', () => {
    for (let t = 0; t < 10; t += 0.37) {
      expect(Math.abs(swayAngle(t, 1))).toBeLessThanOrEqual(SWAY.angle);
    }
  });

  it('starts each puppet at its own place in the sway, the same everywhere', () => {
    const a = '00000000-0000-4000-a000-000000000201';
    const b = '00000000-0000-4000-a000-000000000202';
    expect(phaseOf(a)).toBe(phaseOf(a));
    expect(phaseOf(a)).not.toBe(phaseOf(b));
    for (const id of [a, b, '', 'x']) {
      expect(phaseOf(id)).toBeGreaterThanOrEqual(0);
      expect(phaseOf(id)).toBeLessThan(TAU);
    }
  });
});
