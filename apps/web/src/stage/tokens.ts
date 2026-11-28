/**
 * Battle tokens (F5.5, governance §12 "Battle mode"): their size and colors, where each stands,
 * and where a dragged one goes when it is dropped. Pure: `BattleTokens` draws them.
 */
import type { BattleSide, Square } from '@stagehand/shared';

import type { BattleView } from '@/play/stage';

import { STAGE_COLORS } from './colors';
import type { Point3 } from './dimensions';
import { BATTLE_MAT, besideSpot, squareAt, squareCenter } from './table-layout';

/**
 * A token's measurements (F5.5): the picture stands `height` tall, never wider than `maxWidth`,
 * in a clip on a round base, all sized to the mat's squares.
 */
export const TOKEN = {
  height: BATTLE_MAT.square * 1.6,
  maxWidth: BATTLE_MAT.square * 0.95,
  base: { radius: BATTLE_MAT.square * 0.42, height: 0.01 },
  clip: { width: BATTLE_MAT.square * 0.55, height: 0.024, depth: 0.014 },
} as const;

export const CLIP_COLORS: Record<BattleSide, string> = {
  pc: STAGE_COLORS.clipPc,
  npc: STAGE_COLORS.clipNpc,
  monster: STAGE_COLORS.clipMonster,
};

/** Where each token stands: on its square, or (the GM's) in the rows beside the mat. */
export function tokenSpots(battle: BattleView): Map<string, Point3> {
  const spots = new Map<string, Point3>();
  let waiting = 0;
  for (const token of battle.tokens) {
    if (token.square !== null) {
      spots.set(token.id, squareCenter(battle.size, token.square));
    } else {
      spots.set(token.id, besideSpot(battle.size, waiting));
      waiting += 1;
    }
  }
  return spots;
}

/**
 * Where a token dropped at (x, z) goes (F5.5): the square under it, unless another token has
 * that square, when it stays where it was (undefined); off the mat, back beside it (null).
 */
export function dropTarget(
  battle: BattleView,
  id: string,
  x: number,
  z: number,
): Square | null | undefined {
  const square = squareAt(battle.size, x, z);
  if (square === null) return null;
  const taken = battle.tokens.some(
    (token) =>
      token.id !== id && token.square?.column === square.column && token.square.row === square.row,
  );
  return taken ? undefined : square;
}

/** Whether two places are the same square, or both beside the mat. */
export function sameSquare(a: Square | null, b: Square | null): boolean {
  return a?.column === b?.column && a?.row === b?.row;
}
