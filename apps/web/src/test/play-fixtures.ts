/** Live stages for the play tests (F3.3, F3.4, F3.7): what the server would send each role. */
import type {
  GmStage,
  GmStageObject,
  PlayerStage,
  PlayerStageObject,
  PlaySession,
  PresenceMember,
  StageImage,
} from '@stagehand/shared';

const id = (n: number) => `00000000-0000-4000-a000-${String(n).padStart(12, '0')}`;

export const SESSION: PlaySession = {
  id: id(1),
  number: 3,
  startedAt: '2026-11-15T19:00:00.000Z',
};

export function stageImage(n: number): StageImage {
  return { assetId: id(100 + n), width: 640, height: 1024, version: 3 };
}

export function playerObject(
  n: number,
  overrides: Partial<PlayerStageObject> = {},
): PlayerStageObject {
  return {
    id: id(200 + n),
    kind: 'prop',
    across: 0.5,
    up: 0,
    depthTick: 5,
    scale: 1,
    flipped: false,
    mount: 'stand',
    image: stageImage(n),
    recordId: id(300 + n),
    characterId: null,
    ...overrides,
  };
}

export function gmObject(
  n: number,
  name: string,
  overrides: Partial<GmStageObject> = {},
): GmStageObject {
  return {
    ...playerObject(n),
    subject: { kind: 'record', id: id(300 + n), type: 'prop', name, revealed: false },
    shown: true,
    ...overrides,
  };
}

/** A session with no rolls yet and Fear where it starts (F3.6). */
export const ROLL_STAGE: Pick<
  PlayerStage,
  'fear' | 'fearCap' | 'lastFearSpend' | 'calls' | 'lastRoll'
> = {
  fear: 3,
  fearCap: 12,
  lastFearSpend: null,
  calls: [],
  lastRoll: null,
};

export function playerStage(overrides: Partial<PlayerStage> = {}): PlayerStage {
  return {
    role: 'player',
    session: SESSION,
    sceneLoad: 1,
    curtainOpen: true,
    backdrop: stageImage(0),
    ...ROLL_STAGE,
    objects: [playerObject(1)],
    ...overrides,
  };
}

export function gmStage(overrides: Partial<GmStage> = {}): GmStage {
  return {
    role: 'gm',
    session: SESSION,
    sceneLoad: 1,
    curtainOpen: true,
    backdrop: stageImage(0),
    ...ROLL_STAGE,
    scene: { id: id(400), name: 'Ambush at the market' },
    party: [],
    objects: [
      gmObject(1, 'Stone Well'),
      gmObject(2, 'Secret Trapdoor', { shown: false }),
      gmObject(3, 'Old Marta', {
        kind: 'puppet',
        mount: null,
        shown: false,
        subject: { kind: 'record', id: id(303), type: 'npc', name: 'Old Marta', revealed: false },
      }),
    ],
    ...overrides,
  };
}

export function present(
  n: number,
  displayName: string,
  overrides: Partial<PresenceMember> = {},
): PresenceMember {
  return {
    userId: id(500 + n),
    displayName,
    avatarUrl: null,
    role: 'player',
    characterName: null,
    characterId: null,
    speaking: false,
    voicing: null,
    ...overrides,
  };
}
