import { describe, expect, it } from 'vitest';

import { redactUrl } from './log';

describe('redactUrl', () => {
  it('drops the query string from auth URLs (OAuth code and state)', () => {
    expect(redactUrl('/api/auth/callback/discord?code=secret&state=abc')).toBe(
      '/api/auth/callback/discord',
    );
  });

  it('leaves other URLs untouched', () => {
    expect(redactUrl('/api/me?x=1')).toBe('/api/me?x=1');
    expect(redactUrl('/campaigns/1')).toBe('/campaigns/1');
  });
});
