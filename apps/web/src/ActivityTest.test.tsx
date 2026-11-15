import { act, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ActivitySdk, SpeakingKind } from '@/activity/discord';
import { forgetEntry } from '@/activity/enter';
import { ACTIVITY_TEST_OFF_MESSAGE } from '@/pages/ActivityTestPage';
import type { StageTestCanvasProps } from '@/stage/StageTestCanvas';
import { mockApi, renderAt } from '@/test/app-harness';

// jsdom has no WebGL: the 3D canvas is replaced by a stand-in.
vi.mock('@/stage/StageTestCanvas', () => ({
  StageTestCanvas: (props: StageTestCanvasProps) => (
    <div data-testid="stage-canvas" data-objects={String(props.objectCount)} />
  ),
}));

/** The fake Discord SDK the page is handed, and what it was asked. */
const discord = vi.hoisted(() => ({
  clientIds: [] as string[],
  listener: null as ((kind: 'start' | 'stop', userId: string) => void) | null,
  stopped: 0,
}));

vi.mock('@/activity/discord', () => ({
  activitySdk: (clientId: string): ActivitySdk => {
    discord.clientIds.push(clientId);
    return {
      platform: 'desktop',
      ready: () => Promise.resolve(),
      authorize: () => Promise.resolve('code-1'),
      authenticate: () => Promise.resolve(['identify', 'rpc.voice.read']),
      subscribeSpeaking: (listener) => {
        discord.listener = listener;
        return Promise.resolve(() => {
          discord.stopped += 1;
        });
      },
    };
  },
}));

const socketPaths = vi.hoisted(() => [] as string[]);

vi.mock('@/activity/socket-probe', () => ({
  runSocketProbe: (path: string) => {
    socketPaths.push(path);
    return Promise.resolve({ transport: 'websocket', startedOn: 'polling', roundTripMs: 12 });
  },
}));

/** Adds the Activity test's server to the fake API. `via` is the path form that reaches it. */
function mockActivityServer(via: 'plain' | 'proxy' | 'neither') {
  const api = mockApi(null);
  const rest = api.getMockImplementation();
  const requests: string[] = [];
  let probes = 0;

  api.mockImplementation((input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    const proxied = url.startsWith('/.proxy');
    const path = proxied ? url.slice('/.proxy'.length) : url;
    if (!path.startsWith('/api/activity/')) {
      if (path.startsWith('/api/')) {
        return rest?.(input, init) ?? Promise.reject(new Error('fetch is not mocked'));
      }
      // The page asking for itself.
      return Promise.resolve(new Response('<html></html>'));
    }
    requests.push(`${init?.method ?? 'GET'} ${url}`);
    if (via === 'neither' || proxied !== (via === 'proxy')) {
      return Promise.resolve(Response.json({ error: 'Not Found' }, { status: 404 }));
    }
    if (path.endsWith('/config')) return Promise.resolve(Response.json({ clientId: 'client-123' }));
    if (path.endsWith('/probe')) {
      probes += 1;
      return Promise.resolve(
        Response.json({
          origin: 'http://localhost:5173',
          secFetchSite: 'same-origin',
          host: 'localhost:5173',
          cookieCameBack: probes > 1,
        }),
      );
    }
    return Promise.resolve(
      Response.json({ accessToken: 'token-abc', scopes: ['identify', 'rpc.voice.read'] }),
    );
  });
  return requests;
}

const panel = () => within(screen.getByRole('region', { name: 'Activity test' }));
const probe = (label: string) => panel().getByRole('listitem', { name: label }).textContent;
const report = () => panel().getByLabelText<HTMLTextAreaElement>('Report').value;

/** Waits until every probe has run. */
async function finished() {
  await panel().findByText('Run again', { selector: 'button:not([disabled])' });
}

function say(kind: SpeakingKind, userId: string) {
  act(() => {
    discord.listener?.(kind, userId);
  });
}

afterEach(() => {
  window.history.replaceState({}, '', '/');
});

// Before, not after: the page of the test before is unmounted after that test's own hooks,
// and unmounting ends its speaking subscription.
beforeEach(() => {
  // Inside the frame the app first asks what the server serves, once per page load.
  forgetEntry();
  discord.clientIds.length = 0;
  discord.listener = null;
  discord.stopped = 0;
  socketPaths.length = 0;
});

describe('Activity test page, in a normal tab', () => {
  it('runs the probes that need no Discord and skips the rest, without sign-in', async () => {
    mockActivityServer('plain');
    renderAt('/activity-test');
    await screen.findByTestId('stage-canvas');
    await finished();

    expect(probe('Request paths')).toContain('ok/api works; /.proxy/api answered 404');
    expect(probe('Cookie in the frame')).toContain('ok');
    expect(probe('Socket.IO')).toContain('websocket, after starting on polling; echo in 12 ms');
    for (const label of ['Discord SDK', 'Sign-in inside Discord', 'Speaking events']) {
      expect(probe(label)).toContain('skippedNot inside Discord');
    }
    expect(socketPaths).toEqual(['/socket.io']);
    expect(discord.clientIds).toEqual([]);
    // It fills the window like the stage test: no app header.
    expect(screen.queryByRole('link', { name: 'Stagehand' })).toBeNull();
  });

  it('gives the whole result as text to copy', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    try {
      mockActivityServer('plain');
      renderAt('/activity-test');
      await screen.findByTestId('stage-canvas');
      await finished();

      const lines = report().split('\n');
      expect(lines[0]).toMatch(/^Activity test: in a browser tab, /);
      expect(lines).toContain('- Request paths: ok, /api works; /.proxy/api answered 404');
      expect(lines).toContain('- Discord SDK: skipped, Not inside Discord');
      expect(lines.at(-1)).toBe('Stage test: not measured');

      fireEvent.click(panel().getByRole('button', { name: 'Copy report' }));
      expect(await panel().findByRole('button', { name: 'Copied' })).toBeDefined();
      expect(writeText).toHaveBeenCalledWith(report());
    } finally {
      Reflect.deleteProperty(navigator, 'clipboard');
    }
  });

  it('runs the probes again on request', async () => {
    const requests = mockActivityServer('plain');
    renderAt('/activity-test');
    await screen.findByTestId('stage-canvas');
    await finished();
    const asked = () => requests.filter((request) => request === 'GET /api/activity/config');
    expect(asked()).toHaveLength(1);

    fireEvent.click(panel().getByRole('button', { name: 'Run again' }));
    await finished();

    expect(asked()).toHaveLength(2);
  });

  it('hides and shows its panel', async () => {
    mockActivityServer('plain');
    renderAt('/activity-test');
    await screen.findByTestId('stage-canvas');
    await finished();

    fireEvent.click(panel().getByRole('button', { name: 'Hide' }));
    expect(panel().queryByLabelText('Report')).toBeNull();

    fireEvent.click(panel().getByRole('button', { name: 'Show' }));
    expect(panel().getByLabelText('Report')).toBeDefined();
  });

  it('says so when the server is not serving the test', async () => {
    mockActivityServer('neither');
    renderAt('/activity-test');

    expect(await screen.findByText(ACTIVITY_TEST_OFF_MESSAGE)).toBeDefined();
    expect(screen.getByText('/api answered 404; /.proxy/api answered 404')).toBeDefined();
    expect(screen.queryByTestId('stage-canvas')).toBeNull();
  });
});

describe("Activity test page, inside Discord's frame", () => {
  function openInFrame(via: 'plain' | 'proxy') {
    // Discord opens an Activity at the root path with its launch parameters.
    window.history.replaceState({}, '', '/?instance_id=i-1&frame_id=f-1&platform=desktop');
    const requests = mockActivityServer(via);
    renderAt('/');
    return requests;
  }

  it('takes the place of the whole app and runs every probe', async () => {
    openInFrame('plain');
    await screen.findByTestId('stage-canvas');
    await finished();

    expect(screen.queryByRole('button', { name: 'Sign in with Discord' })).toBeNull();
    expect(probe('Discord SDK')).toContain('ok');
    expect(probe('Discord SDK')).toContain('platform desktop');
    expect(probe('Sign-in inside Discord')).toContain('okscopes identify, rpc.voice.read');
    expect(probe('Speaking events')).toContain('oksubscribed');
    expect(discord.clientIds).toEqual(['client-123']);
    expect(report().split('\n')[0]).toMatch(/^Activity test: inside Discord, /);
  });

  it("goes through Discord's proxy path when only that reaches the server", async () => {
    const requests = openInFrame('proxy');
    await screen.findByTestId('stage-canvas');
    await finished();

    expect(probe('Request paths')).toContain('ok/api answered 404; /.proxy/api works');
    expect(requests).toContain('POST /.proxy/api/activity/probe');
    expect(requests).toContain('POST /.proxy/api/activity/token');
    expect(socketPaths).toEqual(['/.proxy/socket.io']);
  });

  it('counts who talks, without naming them in the report', async () => {
    openInFrame('plain');
    await screen.findByTestId('stage-canvas');
    await finished();

    say('start', 'user-111');
    say('stop', 'user-111');
    say('start', 'user-222');

    expect(panel().getByLabelText('Speaking events heard').textContent).toBe(
      '2 starts and 1 stop from 2 people',
    );
    expect(report()).toContain(
      '- Speaking events: ok, subscribed; 2 starts and 1 stop from 2 people',
    );
    expect(report()).not.toContain('user-111');
  });

  it('ends the speaking subscription when the probes run again', async () => {
    openInFrame('plain');
    await screen.findByTestId('stage-canvas');
    await finished();

    fireEvent.click(panel().getByRole('button', { name: 'Run again' }));
    await finished();

    expect(discord.stopped).toBe(1);
  });
});
