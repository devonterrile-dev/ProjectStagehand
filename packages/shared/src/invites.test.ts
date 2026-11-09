import { describe, expect, it } from 'vitest';

import { createInviteRequestSchema, inviteCodeSchema } from './invites';

describe('inviteCodeSchema', () => {
  it('accepts 22 base64url characters', () => {
    expect(inviteCodeSchema.safeParse('AbCdEfGhIjKlMnOpQr_-12').success).toBe(true);
  });

  it('rejects other lengths and characters', () => {
    expect(inviteCodeSchema.safeParse('short').success).toBe(false);
    expect(inviteCodeSchema.safeParse('a'.repeat(23)).success).toBe(false);
    expect(inviteCodeSchema.safeParse('AbCdEfGhIjKlMnOpQr/+12').success).toBe(false);
  });
});

describe('createInviteRequestSchema', () => {
  it('accepts the three expiry choices only', () => {
    for (const expiresIn of ['never', '1d', '7d']) {
      expect(createInviteRequestSchema.safeParse({ expiresIn }).success).toBe(true);
    }
    expect(createInviteRequestSchema.safeParse({ expiresIn: '30d' }).success).toBe(false);
    expect(createInviteRequestSchema.safeParse({ expiresIn: 'never', maxUses: 3 }).success).toBe(
      false,
    );
  });
});
