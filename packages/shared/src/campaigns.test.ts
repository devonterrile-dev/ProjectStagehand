import { describe, expect, it } from 'vitest';

import {
  campaignListResponseSchema,
  campaignNameSchema,
  createCampaignRequestSchema,
  renameCampaignRequestSchema,
} from './campaigns';

describe('campaignNameSchema', () => {
  it('trims surrounding whitespace', () => {
    expect(campaignNameSchema.parse('  Shattered Coast  ')).toBe('Shattered Coast');
  });

  it('rejects empty and whitespace-only names', () => {
    expect(campaignNameSchema.safeParse('').success).toBe(false);
    expect(campaignNameSchema.safeParse('   ').success).toBe(false);
  });

  it('allows 80 characters and rejects 81', () => {
    expect(campaignNameSchema.safeParse('a'.repeat(80)).success).toBe(true);
    expect(campaignNameSchema.safeParse('a'.repeat(81)).success).toBe(false);
  });
});

describe('create and rename requests', () => {
  it('accept a name', () => {
    expect(createCampaignRequestSchema.parse({ name: ' Iron Vale ' })).toEqual({
      name: 'Iron Vale',
    });
    expect(renameCampaignRequestSchema.parse({ name: 'Iron Vale' })).toEqual({ name: 'Iron Vale' });
  });

  it('reject unknown fields so clients cannot set anything else', () => {
    expect(createCampaignRequestSchema.safeParse({ name: 'X', gmUserId: 'y' }).success).toBe(false);
    expect(renameCampaignRequestSchema.safeParse({ name: 'X', archivedAt: null }).success).toBe(
      false,
    );
  });
});

describe('campaignListResponseSchema', () => {
  it('accepts active and archived campaigns', () => {
    const list = {
      campaigns: [
        {
          id: '0b7e2f1c-3c1d-4b8a-9a50-6f2a0e1d9c11',
          name: 'Shattered Coast',
          role: 'gm',
          archivedAt: null,
          createdAt: '2026-11-09T10:00:00.000Z',
        },
        {
          id: '1c8f3a2d-4d2e-4c9b-8b61-7a3b1f2e0d22',
          name: 'Old One-shot',
          role: 'player',
          archivedAt: '2026-11-09T11:00:00.000+00:00',
          createdAt: '2026-11-01T10:00:00.000Z',
        },
      ],
    };

    expect(campaignListResponseSchema.parse(list)).toEqual(list);
  });

  it('rejects an unknown role', () => {
    const bad = {
      campaigns: [
        {
          id: '0b7e2f1c-3c1d-4b8a-9a50-6f2a0e1d9c11',
          name: 'X',
          role: 'co-gm',
          archivedAt: null,
          createdAt: '2026-11-09T10:00:00.000Z',
        },
      ],
    };
    expect(campaignListResponseSchema.safeParse(bad).success).toBe(false);
  });
});
