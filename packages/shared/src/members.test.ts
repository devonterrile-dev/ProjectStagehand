import { describe, expect, it } from 'vitest';

import { assignCharacterRequestSchema, memberListResponseSchema } from './members';

describe('assignCharacterRequestSchema', () => {
  it('accepts a PC id or null', () => {
    const characterId = '0b7e2f1c-3c1d-4b8a-9a50-6f2a0e1d9c11';
    expect(assignCharacterRequestSchema.parse({ characterId })).toEqual({ characterId });
    expect(assignCharacterRequestSchema.parse({ characterId: null })).toEqual({
      characterId: null,
    });
    expect(assignCharacterRequestSchema.safeParse({}).success).toBe(false);
  });
});

describe('memberListResponseSchema', () => {
  it('accepts a GM and a player with a PC', () => {
    const list = {
      members: [
        {
          userId: '0b7e2f1c-3c1d-4b8a-9a50-6f2a0e1d9c11',
          displayName: 'Mira',
          avatarUrl: null,
          role: 'gm',
          character: null,
          joinedAt: '2026-11-09T10:00:00.000Z',
        },
        {
          userId: '1c8f3a2d-4d2e-4c9b-8b61-7a3b1f2e0d22',
          displayName: 'Tomas',
          avatarUrl: 'https://cdn.discordapp.com/avatars/1/abc.png',
          role: 'player',
          character: { id: '2d9a4b3e-5e3f-4dac-9c72-8b4c2a3f1e33', name: 'Vex' },
          joinedAt: '2026-11-09T11:00:00.000Z',
        },
      ],
    };
    expect(memberListResponseSchema.parse(list)).toEqual(list);
  });
});
