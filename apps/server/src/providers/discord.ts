/**
 * Discord's HTTP API, for the Activity (governance §13): turning the code the Embedded App SDK
 * hands the page into the user's token, and asking who that user is. Behind an interface like
 * every external service (§15). Sign-in in a browser tab does not come through here: Better
 * Auth's own Discord provider handles that (F0.4).
 *
 * Nothing Discord says is passed on or logged: an error answer can quote the code. A token is
 * the user's own; it is returned to the caller and never stored or logged.
 */
import { z } from 'zod';

const DISCORD_TOKEN_URL = 'https://discord.com/api/oauth2/token';
const DISCORD_ME_URL = 'https://discord.com/api/users/@me';
const DISCORD_TIMEOUT_MS = 10_000;

/** Why a call to Discord gave nothing to work with. */
export type DiscordFailure =
  /** Discord answered, but not with success: a bad or used code, a revoked token. */
  | { status: 'refused'; discordStatus: number }
  /** No answer in time, or no connection. */
  | { status: 'unreachable' }
  /** An answer that wasn't what Discord's API promises. */
  | { status: 'garbled' };

export type CodeExchange = { status: 'ok'; accessToken: string; scopes: string[] } | DiscordFailure;
export type DiscordUser = { status: 'ok'; id: string } | DiscordFailure;

export interface DiscordProvider {
  /** Exchanges an Activity's authorization code for the user's access token. */
  exchangeCode(code: string): Promise<CodeExchange>;
  /** The Discord id of the user a token belongs to. Needs the `identify` scope. */
  userOf(accessToken: string): Promise<DiscordUser>;
}

/** What Discord answers a code exchange with; only these two fields are used. */
const tokenSchema = z.object({ access_token: z.string().min(1), scope: z.string() });
const userSchema = z.object({ id: z.string().min(1) });

async function ask(url: string, init: RequestInit): Promise<{ body: unknown } | DiscordFailure> {
  let response: Response;
  try {
    response = await fetch(url, { ...init, signal: AbortSignal.timeout(DISCORD_TIMEOUT_MS) });
  } catch {
    return { status: 'unreachable' };
  }
  if (!response.ok) return { status: 'refused', discordStatus: response.status };
  return { body: await response.json().catch(() => null) };
}

/** `app` is the Discord application that also signs users in (F0.4). */
export function createDiscordProvider(app: {
  clientId: string;
  clientSecret: string;
}): DiscordProvider {
  return {
    async exchangeCode(code) {
      const answer = await ask(DISCORD_TOKEN_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        // The client secret never leaves the server.
        body: new URLSearchParams({
          client_id: app.clientId,
          client_secret: app.clientSecret,
          grant_type: 'authorization_code',
          code,
        }),
      });
      if ('status' in answer) return answer;
      const token = tokenSchema.safeParse(answer.body);
      if (!token.success) return { status: 'garbled' };
      return {
        status: 'ok',
        accessToken: token.data.access_token,
        scopes: token.data.scope.split(' ').filter((scope) => scope !== ''),
      };
    },

    async userOf(accessToken) {
      const answer = await ask(DISCORD_ME_URL, {
        headers: { authorization: `Bearer ${accessToken}` },
      });
      if ('status' in answer) return answer;
      const user = userSchema.safeParse(answer.body);
      return user.success ? { status: 'ok', id: user.data.id } : { status: 'garbled' };
    },
  };
}
