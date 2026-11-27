import { PASS_SPAN, TRAVEL_SPEED } from '@stagehand/shared';
import { describe, expect, it } from 'vitest';

import { OPENING, WORLD_UNITS_PER_PIXEL } from './dimensions';
import { cutoutHeight, LOWERED_GAP } from './scene-layout';
import {
  acrossToX,
  anchorTravel,
  backdropOffset,
  distanceAt,
  halfWidthOf,
  leavingY,
  passAcross,
  passEnded,
} from './travel';

describe('the travel as a browser counts it (F5.4)', () => {
  it('anchors a stage’s travel to when it arrived, and none for a static scene', () => {
    expect(anchorTravel(null, 500)).toBeNull();
    expect(anchorTravel({ playing: true, distance: 1.5 }, 500)).toEqual({
      playing: true,
      distance: 1.5,
      at: 500,
    });
  });

  it('counts on from the anchor while playing, at the server’s speed, and holds while paused', () => {
    const playing = { playing: true, distance: 1, at: 1000 };
    expect(distanceAt(playing, 1000 + 6000)).toBeCloseTo(1 + 6 * TRAVEL_SPEED);
    // A frame drawn a moment before the stage arrived doesn't go back.
    expect(distanceAt(playing, 900)).toBe(1);
    expect(distanceAt({ ...playing, playing: false }, 99_000)).toBe(1);
  });

  it('moves the backdrop one whole image per opening width, the mirrored pair repeating', () => {
    expect(backdropOffset(0)).toBe(0);
    expect(backdropOffset(0.25)).toBe(0.25);
    expect(backdropOffset(2.25)).toBeCloseTo(0.25);
    expect(backdropOffset(3.5)).toBeCloseTo(1.5);
  });
});

describe('passing by (F5.4)', () => {
  const crate = { width: 512, height: 512, scale: 1 };
  const half = halfWidthOf(crate);

  it('measures half a cutout in opening widths', () => {
    expect(half).toBeCloseTo((512 * WORLD_UNITS_PER_PIXEL) / 2 / OPENING.width);
    expect(halfWidthOf({ ...crate, scale: 2 })).toBeCloseTo(2 * half);
  });

  it('comes in from fully behind the right wall and leaves as its left side reaches the left edge', () => {
    // At its start, its left side is at the right edge: out of sight behind the wall.
    expect(passAcross(3, 3, half) - half).toBeCloseTo(1);
    expect(passEnded(3, 3)).toBe(false);
    // Halfway along it is in the middle.
    expect(passAcross(3, 3 + (1 + 2 * half) / 2, half)).toBeCloseTo(0.5);
    // One opening width on, its left side touches the left edge, and the pass is over.
    expect(passAcross(3, 3 + PASS_SPAN, half) - half).toBeCloseTo(0);
    expect(passEnded(3, 3 + PASS_SPAN)).toBe(true);
  });

  it('leaves down through the floor, or up into the roof for a prop that hangs', () => {
    expect(leavingY({ ...crate, mount: 'stand' })).toBeCloseTo(
      -(cutoutHeight(crate) + LOWERED_GAP),
    );
    expect(leavingY({ ...crate, mount: 'stick' })).toBeLessThan(0);
    expect(leavingY({ ...crate, mount: 'hang' })).toBeCloseTo(OPENING.height + LOWERED_GAP);
  });

  it('places across the opening as the theater does', () => {
    expect(acrossToX(0.5)).toBe(0);
    expect(acrossToX(0)).toBeCloseTo(-OPENING.width / 2);
    expect(acrossToX(1)).toBeCloseTo(OPENING.width / 2);
  });
});
