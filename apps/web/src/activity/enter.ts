/**
 * Coming into Stagehand from Discord's Activity frame (F3.3c, governance §13, D-51): find out
 * what this server lets the frame do, shake hands with Discord, and sign in.
 *
 * There is no redirect in a frame. Discord's SDK hands the page a code, the server exchanges it
 * and answers with a Stagehand session cookie that a framed page may keep. After that the app
 * works as it does in a tab: the same routes, the same live room. No React here.
 *
 * Hearing who talks (F3.9, D-57): the sign-in also asks for Discord's voice scope, and the
 * token the server sends back signs the SDK in (`authenticate`, once per launch). Turning it
 * down still signs the player in; the table then falls back to holding T.
 */
import {
  ACTIVITY_NO_ACCOUNT,
  ACTIVITY_SIGN_IN_PATH,
  activityConfigResponseSchema,
  activityTokenResponseSchema,
  meResponseSchema,
  type MeResponse,
} from '@stagehand/shared';

import type { ActivityScope, ActivitySdk } from './discord';

/** Discord's speaking events for this player (F3.9): the SDK, signed in, and who they are. */
export interface ActivityVoice {
  sdk: ActivitySdk;
  discordUserId: string;
}

export type ActivityEntry =
  /**
   * Signed in. `test` says the Activity test page is served too; `voice` is null when Discord
   * didn't let Stagehand hear who talks.
   */
  | { status: 'signed-in'; me: MeResponse; test: boolean; voice: ActivityVoice | null }
  /** This server has no sign-in for the frame: all it can show there is the test page. */
  | { status: 'test-only' }
  /** This Discord account has no Stagehand account yet. */
  | { status: 'no-account'; message: string }
  /** Sign-in worked, but this Discord client did not keep or send back the session cookie. */
  | { status: 'cookie-blocked' }
  | { status: 'failed'; message: string };

export interface EnterDeps {
  fetch: typeof fetch;
  sdk: (clientId: string) => ActivitySdk;
}

/** How long Discord's client gets to answer the SDK's handshake, and its sign-in. */
const READY_WAIT_MS = 15_000;

/** Who the player is, and who talks (F3.9). */
const SCOPES: readonly ActivityScope[] = ['identify', 'rpc.voice.read'];
const VOICE_SCOPE: ActivityScope = 'rpc.voice.read';

export const ENTRY_MESSAGES = {
  discordSilent: "Discord didn't answer. Close the Activity and open it again.",
  declined:
    "Discord didn't let Stagehand see who you are. Stagehand needs that to find your campaigns: open the Activity again and choose Authorize.",
  tooMany: 'Too many sign-ins from here just now. Wait a minute, then try again.',
  server: "Stagehand couldn't sign you in. Try again in a moment.",
  cookieBlocked:
    "This Discord app didn't keep Stagehand's sign-in, so the Activity can't run here. Open Stagehand in a browser to play, with Discord for voice.",
} as const;

const json = { accept: 'application/json', 'content-type': 'application/json' };

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('timed out'));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error('failed'));
      },
    );
  });
}

/** What the sign-in route's error says, when it says something we wrote. */
async function refusalOf(response: Response): Promise<{ code: string | null; message: string }> {
  const body = (await response.json().catch(() => null)) as {
    code?: unknown;
    message?: unknown;
  } | null;
  return {
    code: typeof body?.code === 'string' ? body.code : null,
    message: typeof body?.message === 'string' ? body.message : ENTRY_MESSAGES.server,
  };
}

export async function enterActivity(deps: EnterDeps): Promise<ActivityEntry> {
  // The same paths work in the frame as in a tab (D-48), so no proxy prefix.
  let config;
  try {
    const response = await deps.fetch('/api/activity/config', {
      headers: { accept: 'application/json' },
      cache: 'no-store',
    });
    config = response.ok
      ? activityConfigResponseSchema.safeParse(await response.json().catch(() => null))
      : null;
  } catch {
    config = null;
  }
  if (config?.success !== true || !config.data.signIn) return { status: 'test-only' };
  const { clientId, test } = config.data;

  const sdk = deps.sdk(clientId);
  try {
    await withTimeout(sdk.ready(), READY_WAIT_MS);
  } catch {
    return { status: 'failed', message: ENTRY_MESSAGES.discordSilent };
  }

  let code: string;
  try {
    code = await sdk.authorize(SCOPES);
  } catch {
    // Turned down: perhaps only the voice. Who they are is still enough to play.
    try {
      code = await sdk.authorize(['identify']);
    } catch {
      return { status: 'failed', message: ENTRY_MESSAGES.declined };
    }
  }

  let token;
  try {
    const response = await deps.fetch(ACTIVITY_SIGN_IN_PATH, {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ code }),
    });
    if (!response.ok) {
      const refusal = await refusalOf(response);
      if (response.status === 404 && refusal.code === ACTIVITY_NO_ACCOUNT) {
        return { status: 'no-account', message: refusal.message };
      }
      if (response.status === 429) return { status: 'failed', message: ENTRY_MESSAGES.tooMany };
      return {
        status: 'failed',
        message: response.status >= 500 ? ENTRY_MESSAGES.server : refusal.message,
      };
    }
    // The answer also carries the player's Discord token, for the SDK's `authenticate`.
    token = activityTokenResponseSchema.parse(await response.json());
  } catch {
    return { status: 'failed', message: ENTRY_MESSAGES.server };
  }

  // The proof that the cookie is kept and sent back: without it nothing else would work.
  try {
    const response = await deps.fetch('/api/me', { headers: { accept: 'application/json' } });
    if (response.status === 401) return { status: 'cookie-blocked' };
    if (!response.ok) return { status: 'failed', message: ENTRY_MESSAGES.server };
    const me = meResponseSchema.parse(await response.json());
    return { status: 'signed-in', me, test, voice: await voiceOf(sdk, token) };
  } catch {
    return { status: 'failed', message: ENTRY_MESSAGES.server };
  }
}

/**
 * Signs the SDK in so it can pass on who talks (F3.9), if the player allowed it. Discord takes
 * this once per launch, so it is done here, for the table and the Activity test alike. Never
 * fails: without it the table listens for T instead.
 */
async function voiceOf(
  sdk: ActivitySdk,
  token: { accessToken: string; scopes: readonly string[] },
): Promise<ActivityVoice | null> {
  if (!token.scopes.includes(VOICE_SCOPE)) return null;
  try {
    const signedIn = await withTimeout(sdk.authenticate(token.accessToken), READY_WAIT_MS);
    return signedIn.scopes.includes(VOICE_SCOPE) ? { sdk, discordUserId: signedIn.userId } : null;
  } catch {
    return null;
  }
}

/**
 * One sign-in per try. React runs an effect twice in development; Discord must still be asked
 * once, and the server signed in to once.
 */
let entering: { attempt: number; entry: Promise<ActivityEntry> } | null = null;

export function enterOnce(attempt: number, deps: EnterDeps): Promise<ActivityEntry> {
  if (entering?.attempt !== attempt) entering = { attempt, entry: enterActivity(deps) };
  return entering.entry;
}

let arrived = false;

/**
 * True the first time it is asked in a page load. Arriving in the Activity can take the player
 * straight to a table; coming back to the list later must leave them on it.
 */
export function firstArrival(): boolean {
  if (arrived) return false;
  arrived = true;
  return true;
}

/** Test only: a new page load. */
export function forgetEntry(): void {
  entering = null;
  arrived = false;
}
