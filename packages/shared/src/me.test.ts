import { describe, expect, it } from 'vitest';

import { displayNameSchema, meResponseSchema, updateMeRequestSchema } from './me';

describe('displayNameSchema', () => {
  it('trims surrounding whitespace', () => {
    expect(displayNameSchema.parse('  Mira the Bold  ')).toBe('Mira the Bold');
  });

  it('rejects empty and whitespace-only names', () => {
    expect(displayNameSchema.safeParse('').success).toBe(false);
    expect(displayNameSchema.safeParse('   ').success).toBe(false);
  });

  it('allows 32 characters and rejects 33', () => {
    expect(displayNameSchema.safeParse('a'.repeat(32)).success).toBe(true);
    expect(displayNameSchema.safeParse('a'.repeat(33)).success).toBe(false);
  });
});

describe('updateMeRequestSchema', () => {
  it('accepts a name or null', () => {
    expect(updateMeRequestSchema.parse({ displayName: ' Mira ' })).toEqual({ displayName: 'Mira' });
    expect(updateMeRequestSchema.parse({ displayName: null })).toEqual({ displayName: null });
  });

  it('rejects unknown fields so clients cannot set anything else', () => {
    expect(updateMeRequestSchema.safeParse({ displayName: 'Mira', isAdmin: true }).success).toBe(
      false,
    );
  });
});

describe('meResponseSchema', () => {
  it('accepts a user without an avatar', () => {
    const me = {
      id: '0b7e2f1c-3c1d-4b8a-9a50-6f2a0e1d9c11',
      displayName: 'Mira',
      hasCustomDisplayName: false,
      discordUsername: 'mira',
      avatarUrl: null,
    };

    expect(meResponseSchema.parse(me)).toEqual(me);
  });
});
