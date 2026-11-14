import { describe, expect, it } from 'vitest';

import { CURTAIN_OPEN_COVER, CURTAIN_OPEN_SCALE, curtainCover } from './curtain-cover';

describe('the front curtain', () => {
  it('covers the whole opening when closed', () => {
    expect(curtainCover(1)).toBe(1);
  });

  it('covers 25% of the opening when open', () => {
    expect(CURTAIN_OPEN_COVER).toBe(0.25);
    expect(curtainCover(CURTAIN_OPEN_SCALE)).toBeCloseTo(0.25, 10);
  });

  it('covers nothing once gathered outside the opening', () => {
    expect(curtainCover(0)).toBe(0);
  });

  it('covers more the further it is drawn', () => {
    expect(curtainCover(0.5)).toBeGreaterThan(curtainCover(CURTAIN_OPEN_SCALE));
    expect(curtainCover(0.5)).toBeLessThan(curtainCover(1));
  });
});
