import { describe, expect, it } from 'vitest';

import { formatActivityReport, formatSpeaking } from './report';

describe('formatSpeaking', () => {
  it('counts in plain words', () => {
    expect(formatSpeaking({ starts: 1, stops: 1, people: 1 })).toBe(
      '1 start and 1 stop from 1 person',
    );
    expect(formatSpeaking({ starts: 4, stops: 3, people: 2 })).toBe(
      '4 starts and 3 stops from 2 people',
    );
  });
});

describe('formatActivityReport', () => {
  it('lists every probe in order, then the stage line', () => {
    const report = formatActivityReport({
      inFrame: true,
      browser: 'Chrome 142',
      results: {
        paths: { status: 'ok', detail: '/api works; /.proxy/api works' },
        socket: { status: 'failed', detail: 'could not connect: timeout' },
        speaking: { status: 'ok', detail: 'subscribed' },
      },
      speaking: { starts: 2, stops: 2, people: 1 },
      stageLine: 'Stage test: 30 objects, Chrome 142, GPU, 800×450 at 1x: average 60 fps',
    });

    expect(report.split('\n')).toEqual([
      'Activity test: inside Discord, Chrome 142',
      '- Request paths: ok, /api works; /.proxy/api works',
      '- Page headers: not run',
      '- Origin the server saw: not run',
      '- Cookie in the frame: not run',
      '- Socket.IO: failed, could not connect: timeout',
      '- Discord SDK: not run',
      '- Sign-in inside Discord: not run',
      '- Speaking events: ok, subscribed; 2 starts and 2 stops from 1 person',
      'Stage test: 30 objects, Chrome 142, GPU, 800×450 at 1x: average 60 fps',
    ]);
  });

  it('says where it ran and that the stage was not measured', () => {
    const report = formatActivityReport({
      inFrame: false,
      browser: 'Firefox 160',
      results: { speaking: { status: 'skipped', detail: 'Not inside Discord' } },
      speaking: { starts: 0, stops: 0, people: 0 },
      stageLine: null,
    });

    expect(report).toContain('Activity test: in a browser tab, Firefox 160');
    expect(report).toContain('- Speaking events: skipped, Not inside Discord\n');
    expect(report.endsWith('Stage test: not measured')).toBe(true);
  });
});
