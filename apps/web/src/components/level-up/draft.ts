import type { LevelUpPick } from '@stagehand/shared';

/**
 * The level-up guide's picks while the player goes through it (F4.9). Nothing reaches the server
 * until Finish; the draft is kept in this browser for the level being taken.
 */
export interface LevelUpDraft {
  step: number;
  picks: LevelUpPick[];
  cardId: string | null;
  extraCardId: string | null;
  swapOutId: string | null;
  swapInId: string | null;
}

export const NEW_LEVEL_UP_DRAFT: LevelUpDraft = Object.freeze({
  step: 0,
  picks: [],
  cardId: null,
  extraCardId: null,
  swapOutId: null,
  swapInId: null,
});

const keyOf = (characterId: string, level: number) =>
  `stagehand:level-up:${characterId}:${String(level)}`;

const isId = (value: unknown): value is string | null =>
  value === null || (typeof value === 'string' && value.length > 0);

/** The draft kept for this level, or null when there is none or it can't be read. */
export function loadLevelUpDraft(characterId: string, level: number): LevelUpDraft | null {
  try {
    const raw = window.localStorage.getItem(keyOf(characterId, level));
    if (raw === null) return null;
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null) return null;
    const d = value as Record<string, unknown>;
    const picks = d['picks'];
    if (
      typeof d['step'] !== 'number' ||
      !Array.isArray(picks) ||
      !picks.every(
        (pick) =>
          typeof pick === 'object' &&
          pick !== null &&
          typeof (pick as Record<string, unknown>)['tier'] === 'number' &&
          typeof (pick as Record<string, unknown>)['option'] === 'string',
      ) ||
      !isId(d['cardId']) ||
      !isId(d['extraCardId']) ||
      !isId(d['swapOutId']) ||
      !isId(d['swapInId'])
    ) {
      return null;
    }
    return {
      step: d['step'],
      picks: picks as LevelUpPick[],
      cardId: d['cardId'],
      extraCardId: d['extraCardId'],
      swapOutId: d['swapOutId'],
      swapInId: d['swapInId'],
    };
  } catch {
    return null;
  }
}

export function saveLevelUpDraft(characterId: string, level: number, draft: LevelUpDraft): void {
  try {
    window.localStorage.setItem(keyOf(characterId, level), JSON.stringify(draft));
  } catch {
    // Storage may be full or blocked; the guide works without it.
  }
}

export function clearLevelUpDraft(characterId: string, level: number): void {
  try {
    window.localStorage.removeItem(keyOf(characterId, level));
  } catch {
    // Nothing to clear.
  }
}
