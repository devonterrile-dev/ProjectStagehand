import { describe, expect, it } from 'vitest';

import { browserName, formatReport } from './perf-report';

const WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)';

describe('browserName', () => {
  it.each([
    [
      `${WINDOWS} AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36`,
      'Chrome 142',
    ],
    [
      `${WINDOWS} AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36 Edg/142.0.0.0`,
      'Edge 142',
    ],
    [`${WINDOWS}; rv:145.0) Gecko/20100101 Firefox/145.0`, 'Firefox 145'],
    [
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.1 Safari/605.1.15',
      'Safari 19',
    ],
    [
      `${WINDOWS} AppleWebKit/537.36 (KHTML, like Gecko) discord/1.0.9210 Chrome/134.0.0.0 Electron/35.1.5 Safari/537.36`,
      'Discord 1.0',
    ],
    ['something else entirely', 'Unknown browser'],
  ])('reads %s', (userAgent, expected) => {
    expect(browserName(userAgent)).toBe(expected);
  });
});

describe('formatReport', () => {
  const summary = { frames: 1800, seconds: 30, averageFps: 59.6, lowFps: 47.2 };

  it('says what was drawn, on what, and how smoothly, in one line', () => {
    expect(
      formatReport({
        objects: 30,
        browser: 'Chrome 142',
        gpu: 'ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)',
        width: 1536,
        height: 742.5,
        pixelRatio: 1.25,
        summary,
      }),
    ).toBe(
      'Stage test: 30 objects, Chrome 142, ' +
        'ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11), ' +
        '1536×743 at 1.25x: average 60 fps, slowest 1% 47 fps',
    );
  });

  it('shortens a very long GPU name', () => {
    const line = formatReport({
      objects: 10,
      browser: 'Firefox 145',
      gpu: 'G'.repeat(200),
      width: 800,
      height: 600,
      pixelRatio: 1,
      summary,
    });
    expect(line).toContain(`${'G'.repeat(89)}…,`);
    expect(line).not.toContain('G'.repeat(90));
  });
});
