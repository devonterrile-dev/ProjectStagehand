import { describe, expect, it } from 'vitest';

import { summarizeFrames } from './frame-stats';

describe('summarizeFrames', () => {
  it('reads a steady 60 fps as 60 on both counts', () => {
    const summary = summarizeFrames(Array.from({ length: 600 }, () => 1 / 60));
    expect(summary?.frames).toBe(600);
    expect(summary?.seconds).toBeCloseTo(10, 6);
    expect(summary?.averageFps).toBeCloseTo(60, 6);
    expect(summary?.lowFps).toBeCloseTo(60, 6);
  });

  it('shows stutter in the slowest 1% while the average barely moves', () => {
    // 990 smooth frames and 10 that took four times as long.
    const frames = [
      ...Array.from({ length: 990 }, () => 1 / 60),
      ...Array.from({ length: 10 }, () => 4 / 60),
    ];
    const summary = summarizeFrames(frames);
    expect(summary?.averageFps).toBeGreaterThan(57);
    expect(summary?.lowFps).toBeCloseTo(15, 6);
  });

  it('leaves out frames from a hidden tab and nonsense values', () => {
    const summary = summarizeFrames([1 / 30, 12, 1 / 30, 0, -1, Number.NaN]);
    expect(summary?.frames).toBe(2);
    expect(summary?.averageFps).toBeCloseTo(30, 6);
  });

  it('has nothing to say about no frames', () => {
    expect(summarizeFrames([])).toBeNull();
    expect(summarizeFrames([5, 0])).toBeNull();
  });
});
