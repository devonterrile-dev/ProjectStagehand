import { describe, expect, it } from 'vitest';

import {
  ACTIVITY_CODE_MAX,
  ACTIVITY_SOCKET,
  activityProbeResponseSchema,
  activityTokenRequestSchema,
  activityTokenResponseSchema,
} from './activity';

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
