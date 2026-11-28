import { describe, expect, it } from 'vitest';

import type { BattleTokenView, BattleView } from '@/play/stage';

import { rayAtHeight } from './placement';
import { BATTLE_MAT, besideSpot, matSide, squareAt, squareCenter } from './table-layout';
import { dropTarget, sameSquare, tokenSpots } from './tokens';

function token(id: string, square: BattleTokenView['square']): BattleTokenView {
  return { id, side: 'pc', url: `/${id}.webp`, width: 640, height: 1024, name: id, square };
}

describe('the battle mat’s squares (F5.5)', () => {
  it('finds the square under each square’s middle, on every size of mat', () => {
    for (const size of ['small', 'medium', 'large'] as const) {
      const last = matSide(size) / BATTLE_MAT.square - 1;
      for (const square of [
        { column: 0, row: 0 },
        { column: last, row: 0 },
        { column: 3, row: last },
      ]) {
        const [x, , z] = squareCenter(size, square);
        expect(squareAt(size, x, z)).toEqual(square);
      }
    }
  });

  it('finds no square off the grid', () => {
    const [x, , z] = squareCenter('small', { column: 0, row: 0 });
    expect(squareAt('small', x - BATTLE_MAT.square, z)).toBeNull();
    expect(squareAt('small', x, z - BATTLE_MAT.square)).toBeNull();
    const [farX, , farZ] = squareCenter('small', { column: 5, row: 5 });
    expect(squareAt('small', farX + BATTLE_MAT.square, farZ)).toBeNull();
  });

  it('stands waiting tokens in rows to the left of the mat, clear of it', () => {
    const [firstX, , firstZ] = besideSpot('medium', 0);
    const [nextX, , nextZ] = besideSpot('medium', 1);
    const [belowX, , belowZ] = besideSpot('medium', BATTLE_MAT.besideColumns);
    expect(squareAt('medium', firstX, firstZ)).toBeNull();
    expect(firstX).toBeLessThan(squareCenter('medium', { column: 0, row: 0 })[0]);
    expect(nextX).toBeLessThan(firstX);
    expect(nextZ).toBe(firstZ);
    expect(belowX).toBe(firstX);
    expect(belowZ).toBeGreaterThan(firstZ);
  });
});

describe('battle tokens (F5.5)', () => {
  const battle: BattleView = {
    size: 'small',
    strokes: [],
    tokens: [token('a', null), token('b', { column: 1, row: 2 }), token('c', null)],
  };

  it('stand on their squares, and the rest in the rows beside the mat, in order', () => {
    const spots = tokenSpots(battle);
    expect(spots.get('b')).toEqual(squareCenter('small', { column: 1, row: 2 }));
    expect(spots.get('a')).toEqual(besideSpot('small', 0));
    expect(spots.get('c')).toEqual(besideSpot('small', 1));
  });

  it('go to a free square when dropped, back beside the mat off it, and stay put on a taken one', () => {
    const free = squareCenter('small', { column: 4, row: 4 });
    expect(dropTarget(battle, 'a', free[0], free[2])).toEqual({ column: 4, row: 4 });
    const taken = squareCenter('small', { column: 1, row: 2 });
    expect(dropTarget(battle, 'a', taken[0], taken[2])).toBeUndefined();
    // Its own square is free to it.
    expect(dropTarget(battle, 'b', taken[0], taken[2])).toEqual({ column: 1, row: 2 });
    const off = besideSpot('small', 0);
    expect(dropTarget(battle, 'b', off[0], off[2])).toBeNull();
  });

  it('tell when two places are the same', () => {
    expect(sameSquare(null, null)).toBe(true);
    expect(sameSquare({ column: 1, row: 2 }, { column: 1, row: 2 })).toBe(true);
    expect(sameSquare({ column: 1, row: 2 }, null)).toBe(false);
    expect(sameSquare({ column: 1, row: 2 }, { column: 2, row: 1 })).toBe(false);
  });

  it('are dragged on the table’s top, where the pointer’s ray meets it', () => {
    expect(rayAtHeight({ origin: [0, 2, 3], direction: [0, -1, -1] }, 0)).toEqual({ x: 0, z: 1 });
    // Running level, or pointing away from the table, it never meets it.
    expect(rayAtHeight({ origin: [0, 2, 3], direction: [1, 0, 0] }, 0)).toBeNull();
    expect(rayAtHeight({ origin: [0, 2, 3], direction: [0, 1, 0] }, 0)).toBeNull();
  });
});
