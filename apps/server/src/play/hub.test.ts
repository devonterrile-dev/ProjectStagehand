import { SESSION_MAX_PLAYERS, type PresenceMember } from '@stagehand/shared';
import { describe, expect, it } from 'vitest';

import { PlayHub } from './hub';

const CAMPAIGN = 'campaign-a';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function member(n: number, overrides: Partial<PresenceMember> = {}): PresenceMember {
  return {
    userId: id(n),
    displayName: `Player ${String(n)}`,
    avatarUrl: null,
    role: 'player',
    characterName: null,
    ...overrides,
  };
}

const gm = member(100, { displayName: 'Zed the GM', role: 'gm' });

/** A hub whose campaign already has its 6 players, each on one connection. */
function fullHub(): PlayHub {
  const hub = new PlayHub();
  for (let n = 1; n <= SESSION_MAX_PLAYERS; n += 1) {
    expect(hub.enter(CAMPAIGN, member(n), `socket-${String(n)}`)).toBe(true);
  }
  return hub;
}

describe('PlayHub', () => {
  it('lists the GM first, then players by name', () => {
    const hub = new PlayHub();
    hub.enter(CAMPAIGN, member(2, { displayName: 'mira' }), 's2');
    hub.enter(CAMPAIGN, member(1, { displayName: 'Sam' }), 's1');
    hub.enter(CAMPAIGN, gm, 's100');
    hub.enter(CAMPAIGN, member(3, { displayName: 'Ana' }), 's3');

    expect(hub.presence(CAMPAIGN).map((person) => person.displayName)).toEqual([
      'Zed the GM',
      'Ana',
      'mira',
      'Sam',
    ]);
  });

  it('turns the 7th player away, but not the GM', () => {
    const hub = fullHub();

    expect(hub.enter(CAMPAIGN, member(7), 'socket-7')).toBe(false);
    expect(hub.enter(CAMPAIGN, gm, 'socket-gm')).toBe(true);
    expect(hub.presence(CAMPAIGN)).toHaveLength(SESSION_MAX_PLAYERS + 1);
    expect(hub.presence(CAMPAIGN).map((person) => person.userId)).not.toContain(id(7));
  });

  it('gives a second tab of a seated player no new seat, and takes none away', () => {
    const hub = fullHub();

    expect(hub.enter(CAMPAIGN, member(3), 'socket-3-second-tab')).toBe(true);
    expect(hub.presence(CAMPAIGN)).toHaveLength(SESSION_MAX_PLAYERS);
  });

  it('keeps someone listed until their last connection goes', () => {
    const hub = new PlayHub();
    hub.enter(CAMPAIGN, member(1), 'tab-1');
    hub.enter(CAMPAIGN, member(1), 'tab-2');

    expect(hub.leave(CAMPAIGN, id(1), 'tab-1')).toBe(false);
    expect(hub.presence(CAMPAIGN)).toHaveLength(1);
    expect(hub.leave(CAMPAIGN, id(1), 'tab-2')).toBe(true);
    expect(hub.presence(CAMPAIGN)).toEqual([]);
  });

  it('frees a seat when a player leaves', () => {
    const hub = fullHub();

    expect(hub.leave(CAMPAIGN, id(4), 'socket-4')).toBe(true);

    expect(hub.enter(CAMPAIGN, member(7), 'socket-7')).toBe(true);
  });

  it('shows a name or PC that changed when the person comes in again', () => {
    const hub = new PlayHub();
    hub.enter(CAMPAIGN, member(1), 'tab-1');

    hub.enter(CAMPAIGN, member(1, { displayName: 'Renamed', characterName: 'Vex' }), 'tab-2');

    expect(hub.presence(CAMPAIGN)).toEqual([
      expect.objectContaining({ displayName: 'Renamed', characterName: 'Vex' }),
    ]);
  });

  it('keeps campaigns apart', () => {
    const hub = fullHub();

    expect(hub.enter('campaign-b', member(7), 'socket-7')).toBe(true);
    expect(hub.presence('campaign-b')).toHaveLength(1);
    expect(hub.leave('campaign-b', id(1), 'socket-1')).toBe(false);
    expect(hub.presence(CAMPAIGN)).toHaveLength(SESSION_MAX_PLAYERS);
  });

  it('ignores a connection it never seated', () => {
    const hub = new PlayHub();

    expect(hub.leave(CAMPAIGN, id(1), 'nobody')).toBe(false);
    expect(hub.presence(CAMPAIGN)).toEqual([]);
  });

  it('empties a campaign when its session ends', () => {
    const hub = fullHub();

    hub.clear(CAMPAIGN);

    expect(hub.presence(CAMPAIGN)).toEqual([]);
    expect(hub.enter(CAMPAIGN, member(7), 'socket-7')).toBe(true);
  });
});
