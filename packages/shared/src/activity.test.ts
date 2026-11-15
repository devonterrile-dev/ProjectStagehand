import { describe, expect, it } from 'vitest';

import {
  ACTIVITY_CODE_MAX,
  ACTIVITY_SIGN_IN_PATH,
  ACTIVITY_SOCKET,
  activityConfigResponseSchema,
  activityProbeResponseSchema,
  activityTokenRequestSchema,
  activityTokenResponseSchema,
  discordActivityOrigin,
} from './activity';

describe('discordActivityOrigin', () => {
  it("is Discord's proxy for one application", () => {
    expect(discordActivityOrigin('1234567890')).toBe('https://1234567890.discordsays.com');
  });
});

describe('activityConfigResponseSchema', () => {
  it('says what the frame may do, and nothing is on unless said', () => {
    expect(activityConfigResponseSchema.parse({ clientId: 'abc' })).toEqual({
      clientId: 'abc',
      signIn: false,
      test: false,
    });
    expect(activityConfigResponseSchema.parse({ clientId: 'abc', signIn: true })).toMatchObject({
      signIn: true,
      test: false,
    });
    expect(activityConfigResponseSchema.safeParse({ signIn: true }).success).toBe(false);
  });
});

describe('ACTIVITY_SIGN_IN_PATH', () => {
  it("is one of Better Auth's routes, and not one of its own sign-in paths", () => {
    // Better Auth limits paths that start with /sign-in far more tightly than a whole table
    // opening the Activity at once would need.
    expect(ACTIVITY_SIGN_IN_PATH).toBe('/api/auth/activity/sign-in');
  });
});

describe('activityTokenRequestSchema', () => {
  it('accepts a code', () => {
    expect(activityTokenRequestSchema.parse({ code: 'abc123' })).toEqual({ code: 'abc123' });
  });

  it('rejects a missing, empty or oversized code', () => {
    for (const bad of [{}, { code: '' }, { code: 'x'.repeat(ACTIVITY_CODE_MAX + 1) }, null]) {
      expect(activityTokenRequestSchema.safeParse(bad).success).toBe(false);
    }
  });
});

describe('activityProbeResponseSchema', () => {
  it('allows headers the browser did not send', () => {
    const seen = { origin: null, secFetchSite: null, host: 'localhost', cookieCameBack: false };
    expect(activityProbeResponseSchema.parse(seen)).toEqual(seen);
  });
});

describe('activityTokenResponseSchema', () => {
  it('needs a token', () => {
    expect(activityTokenResponseSchema.safeParse({ accessToken: '', scopes: [] }).success).toBe(
      false,
    );
  });
});

describe('ACTIVITY_SOCKET', () => {
  it("uses Socket.IO's default path and its own namespace", () => {
    expect(ACTIVITY_SOCKET.path).toBe('/socket.io');
    expect(ACTIVITY_SOCKET.namespace).toBe('/activity-probe');
  });
});
