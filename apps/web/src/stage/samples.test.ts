import { describe, expect, it } from 'vitest';

import { SAMPLE_BACKDROPS, SAMPLE_CUTOUTS, STAGE_SAMPLES } from './samples';

describe('the bundled stage samples', () => {
  it('has two backdrops and six cutouts, each with an image', () => {
    expect(SAMPLE_BACKDROPS).toHaveLength(2);
    expect(SAMPLE_CUTOUTS).toHaveLength(6);
    for (const sample of STAGE_SAMPLES) {
      expect(sample.url).not.toBe('');
    }
  });

  it('keeps backdrops at 16:9 and cutouts at 1024 px on their longest side (D-43)', () => {
    for (const backdrop of SAMPLE_BACKDROPS) {
      expect(backdrop.width / backdrop.height).toBeCloseTo(16 / 9, 2);
    }
    for (const cutout of SAMPLE_CUTOUTS) {
      expect(Math.max(cutout.width, cutout.height)).toBe(1024);
    }
  });

  it('names each sample for people', () => {
    expect(SAMPLE_BACKDROPS.map((sample) => sample.label)).toEqual([
      'Forest path',
      'Village square',
    ]);
  });
});
