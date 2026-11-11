import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { readRecent, RECENT_STORED, rememberRecent } from './recent-items';

const CAMPAIGN = 'c1';

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('recent items', () => {
  it('keeps each item once, newest first, per campaign', () => {
    rememberRecent(CAMPAIGN, { kind: 'record', id: 'a' });
    rememberRecent(CAMPAIGN, { kind: 'statBlock', id: 'b' });
    rememberRecent(CAMPAIGN, { kind: 'record', id: 'a' });
    rememberRecent('other', { kind: 'character', id: 'c' });

    expect(readRecent(CAMPAIGN)).toEqual([
      { kind: 'record', id: 'a' },
      { kind: 'statBlock', id: 'b' },
    ]);
    expect(readRecent('other')).toEqual([{ kind: 'character', id: 'c' }]);
  });

  it(`keeps at most ${String(RECENT_STORED)}`, () => {
    for (let i = 0; i < RECENT_STORED + 3; i += 1) {
      rememberRecent(CAMPAIGN, { kind: 'record', id: String(i) });
    }
    const recent = readRecent(CAMPAIGN);
    expect(recent).toHaveLength(RECENT_STORED);
    expect(recent[0]).toEqual({ kind: 'record', id: String(RECENT_STORED + 2) });
  });

  it('ignores garbled storage', () => {
    window.localStorage.setItem(`stagehand:recent:${CAMPAIGN}`, 'not json');
    expect(readRecent(CAMPAIGN)).toEqual([]);
    window.localStorage.setItem(
      `stagehand:recent:${CAMPAIGN}`,
      JSON.stringify([
        { kind: 'spell', id: 'x' },
        { kind: 'record' },
        'x',
        { kind: 'record', id: 'y' },
      ]),
    );
    expect(readRecent(CAMPAIGN)).toEqual([{ kind: 'record', id: 'y' }]);
  });

  it('goes without when storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });

    expect(() => {
      rememberRecent(CAMPAIGN, { kind: 'record', id: 'a' });
    }).not.toThrow();
    expect(readRecent(CAMPAIGN)).toEqual([]);
  });
});
