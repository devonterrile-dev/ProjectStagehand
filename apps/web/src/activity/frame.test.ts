import { describe, expect, it } from 'vitest';

import { isActivityFrame, PATH_PREFIXES, PROXY_PREFIX, withPrefix } from './frame';

describe('isActivityFrame', () => {
  it('is true for the query Discord launches an Activity with', () => {
    expect(isActivityFrame('?instance_id=i-1&frame_id=f-1&platform=desktop')).toBe(true);
  });

  it('is false in a normal tab', () => {
    expect(isActivityFrame('')).toBe(false);
    expect(isActivityFrame('?error=access_denied')).toBe(false);
  });
});

describe('withPrefix', () => {
  it('leaves a path alone, or puts it behind the proxy path', () => {
    expect(withPrefix('', '/api/activity/config')).toBe('/api/activity/config');
    expect(withPrefix(PROXY_PREFIX, '/socket.io')).toBe('/.proxy/socket.io');
  });

  it('tries the plain path first', () => {
    expect(PATH_PREFIXES).toEqual(['', '/.proxy']);
  });
});
