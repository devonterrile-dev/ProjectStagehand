/**
 * The Discord Activity test's probes (governance §13): each one asks a question whose answer
 * decides how live sessions (F3.3) and speaking detection (F3.9) are built. Everything that
 * touches the network, Discord or a socket is passed in, so the probes run the same in a test.
 */
import {
  ACTIVITY_SOCKET,
  activityConfigResponseSchema,
  activityProbeResponseSchema,
  activityTokenResponseSchema,
  type ActivityProbeResponse,
} from '@stagehand/shared';

import type { ActivityScope, ActivitySdk, SpeakingKind } from './discord';
import { PATH_PREFIXES, withPrefix, type PathPrefix } from './frame';
import type { SocketOutcome } from './socket-probe';

/** In the order they run and are reported. */
export const PROBE_IDS = [
  'paths',
  'headers',
  'origin',
  'cookie',
  'socket',
  'sdk',
  'signIn',
  'speaking',
] as const;
export type ProbeId = (typeof PROBE_IDS)[number];

export const PROBE_LABELS: Record<ProbeId, string> = {
  paths: 'Request paths',
  headers: 'Page headers',
  origin: 'Origin the server saw',
  cookie: 'Cookie in the frame',
  socket: 'Socket.IO',
  sdk: 'Discord SDK',
  signIn: 'Sign-in inside Discord',
  speaking: 'Speaking events',
};

export interface ProbeResult {
  status: 'ok' | 'failed' | 'skipped';
  /** One line on what was found. Never a name, an id or a token. */
  detail: string;
}

export interface ProbeDeps {
  fetch: typeof fetch;
  /** Is the page inside Discord's frame? The Discord probes are skipped in a normal tab. */
  inFrame: boolean;
  /** The page's own path and query, asked for again to read its response headers. */
  pageUrl: string;
  sdk: (clientId: string) => ActivitySdk;
  socketProbe: (path: string) => Promise<SocketOutcome>;
  /** Milliseconds, for timing. */
  now: () => number;
}

export interface ProbeEvents {
  /** True once the run is no longer wanted (the page closed, or "Run again" was pressed). */
  cancelled: () => boolean;
  result: (id: ProbeId, result: ProbeResult) => void;
  speaking: (kind: SpeakingKind, userId: string) => void;
  /** Handed the function that ends the speaking subscription. */
  cleanup: (dispose: () => void) => void;
}

export const NOT_IN_DISCORD = 'Not inside Discord';

const SDK_READY_TIMEOUT_MS = 10_000;
const HEADER_MAX = 700;
const JSON_HEADERS = { accept: 'application/json', 'content-type': 'application/json' };

const ok = (detail: string): ProbeResult => ({ status: 'ok', detail });
const failed = (detail: string): ProbeResult => ({ status: 'failed', detail });
const skipped = (detail: string): ProbeResult => ({ status: 'skipped', detail });

/** An error in words: Discord's SDK rejects with plain `{ code, message }` objects. */
export function describeError(error: unknown): string {
  if (error instanceof Error && error.message !== '') return error.message;
  if (typeof error === 'object' && error !== null) {
    const { code, message } = error as { code?: unknown; message?: unknown };
    if (typeof message === 'string' && message !== '') {
      return typeof code === 'number' ? `${message} (code ${String(code)})` : message;
    }
  }
  return 'no reason given';
}

function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${what} did not answer in ${String(ms / 1000)} s`));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(describeError(error)));
      },
    );
  });
}

/** Asks for the test's config at one path form; the client id when that form works. */
async function tryConfig(
  fetchFn: typeof fetch,
  prefix: PathPrefix,
): Promise<{ clientId: string | null; note: string }> {
  try {
    const response = await fetchFn(withPrefix(prefix, '/api/activity/config'), {
      headers: { accept: 'application/json' },
      cache: 'no-store',
    });
    if (!response.ok) return { clientId: null, note: `answered ${String(response.status)}` };
    const body: unknown = await response.json().catch(() => null);
    const parsed = activityConfigResponseSchema.safeParse(body);
    return parsed.success
      ? { clientId: parsed.data.clientId, note: 'works' }
      : { clientId: null, note: 'answered something else' };
  } catch {
    // The browser refused to send it (a content security policy) or nothing answered.
    return { clientId: null, note: 'was blocked' };
  }
}

async function postProbe(
  fetchFn: typeof fetch,
  prefix: PathPrefix,
): Promise<ActivityProbeResponse> {
  const response = await fetchFn(withPrefix(prefix, '/api/activity/probe'), {
    method: 'POST',
    headers: JSON_HEADERS,
    body: '{}',
    credentials: 'same-origin',
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`the server answered ${String(response.status)}`);
  return activityProbeResponseSchema.parse(await response.json());
}

/** Authorize, exchange the code on the server, authenticate; the scopes Discord granted. */
async function signIn(
  deps: ProbeDeps,
  sdk: ActivitySdk,
  prefix: PathPrefix,
  scopes: readonly ActivityScope[],
): Promise<string[]> {
  const code = await sdk.authorize(scopes);
  const response = await deps.fetch(withPrefix(prefix, '/api/activity/token'), {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ code }),
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`the server answered ${String(response.status)} for the code`);
  const token = activityTokenResponseSchema.parse(await response.json());
  return sdk.authenticate(token.accessToken);
}

/**
 * Runs every probe in order, reporting each result as it is known. Resolves to false when the
 * server is not serving the Activity test at either path form, in which case nothing else ran.
 */
export async function runProbes(deps: ProbeDeps, events: ProbeEvents): Promise<boolean> {
  // 1. Which path form reaches the server: /api/… or /.proxy/api/…?
  const tried = [];
  for (const prefix of PATH_PREFIXES) {
    tried.push({ prefix, ...(await tryConfig(deps.fetch, prefix)) });
  }
  if (events.cancelled()) return true;
  const working = tried.find((attempt) => attempt.clientId !== null);
  const pathsDetail = tried.map((attempt) => `${attempt.prefix}/api ${attempt.note}`).join('; ');
  if (working?.clientId == null) {
    events.result('paths', failed(pathsDetail));
    return false;
  }
  events.result('paths', ok(pathsDetail));
  const { prefix, clientId } = working;

  // 2. Does our frame-ancestors header reach the frame, or does Discord send its own policy?
  try {
    const response = await deps.fetch(deps.pageUrl, {
      headers: { accept: 'text/html' },
      cache: 'no-store',
    });
    const policy = response.headers.get('content-security-policy');
    events.result(
      'headers',
      ok(
        policy === null
          ? 'no Content-Security-Policy header'
          : `Content-Security-Policy: ${policy.length > HEADER_MAX ? `${policy.slice(0, HEADER_MAX)}…` : policy}`,
      ),
    );
  } catch {
    events.result('headers', failed('the page could not ask for itself: the request was blocked'));
  }
  if (events.cancelled()) return true;

  // 3 and 4. What origin does the server see, and does a frame-friendly cookie come back?
  try {
    const first = await postProbe(deps.fetch, prefix);
    events.result(
      'origin',
      ok(
        `Origin ${first.origin ?? 'not sent'}, Sec-Fetch-Site ${first.secFetchSite ?? 'not sent'}, ` +
          `Host ${first.host ?? 'not sent'}`,
      ),
    );
    const second = first.cookieCameBack ? first : await postProbe(deps.fetch, prefix);
    events.result(
      'cookie',
      second.cookieCameBack
        ? ok('a SameSite=None; Secure; Partitioned cookie came back')
        : failed('a SameSite=None; Secure; Partitioned cookie did not come back'),
    );
  } catch (error) {
    const detail = describeError(error);
    events.result('origin', failed(detail));
    events.result('cookie', failed(detail));
  }
  if (events.cancelled()) return true;

  // 5. Does Socket.IO get through, and as a websocket?
  try {
    const outcome = await deps.socketProbe(withPrefix(prefix, ACTIVITY_SOCKET.path));
    const how =
      outcome.transport !== 'websocket'
        ? `${outcome.transport} only: no websocket got through`
        : outcome.startedOn === 'websocket'
          ? 'websocket'
          : `websocket, after starting on ${outcome.startedOn}`;
    events.result('socket', ok(`${how}; echo in ${String(Math.round(outcome.roundTripMs))} ms`));
  } catch (error) {
    events.result('socket', failed(`could not connect: ${describeError(error)}`));
  }
  if (events.cancelled()) return true;

  if (!deps.inFrame) {
    for (const id of ['sdk', 'signIn', 'speaking'] as const) {
      events.result(id, skipped(NOT_IN_DISCORD));
    }
    return true;
  }

  // 6. Does Discord's SDK connect?
  let sdk: ActivitySdk;
  try {
    const started = deps.now();
    sdk = deps.sdk(clientId);
    await withTimeout(sdk.ready(), SDK_READY_TIMEOUT_MS, 'Discord');
    events.result(
      'sdk',
      ok(`ready in ${String(Math.round(deps.now() - started))} ms, platform ${sdk.platform}`),
    );
  } catch (error) {
    events.result('sdk', failed(describeError(error)));
    events.result('signIn', skipped('The Discord SDK did not connect'));
    events.result('speaking', skipped('The Discord SDK did not connect'));
    return true;
  }
  if (events.cancelled()) return true;

  // 7. Sign-in without a redirect, asking for the voice scope; without it if Discord refuses.
  let granted: string[];
  try {
    granted = await signIn(deps, sdk, prefix, ['identify', 'rpc.voice.read']);
    events.result('signIn', ok(`scopes ${granted.join(', ')}`));
  } catch (withVoice) {
    try {
      granted = await signIn(deps, sdk, prefix, ['identify']);
      events.result(
        'signIn',
        ok(
          `with identify alone: asking for rpc.voice.read as well failed (${describeError(withVoice)})`,
        ),
      );
    } catch (error) {
      events.result('signIn', failed(describeError(error)));
      events.result('speaking', skipped('Sign-in failed'));
      return true;
    }
  }
  if (events.cancelled()) return true;

  // 8. Do speaking events arrive?
  if (!granted.includes('rpc.voice.read')) {
    events.result('speaking', failed('the rpc.voice.read scope was not granted'));
    return true;
  }
  try {
    const stop = await sdk.subscribeSpeaking(events.speaking);
    events.cleanup(stop);
    events.result('speaking', ok('subscribed'));
  } catch (error) {
    events.result('speaking', failed(`could not subscribe: ${describeError(error)}`));
  }
  return true;
}
