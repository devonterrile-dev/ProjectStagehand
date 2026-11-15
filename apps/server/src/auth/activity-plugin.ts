/**
 * Signing in inside Discord's Activity frame (F3.3c, governance §13, D-51).
 *
 * A tab signs in with a redirect to Discord and back. A frame can't: Discord's SDK hands the
 * page a code instead, and the page posts it here. The server exchanges the code (the client
 * secret never leaves it), asks Discord who the user is, and signs that Discord user's existing
 * Stagehand account in. Nobody gets an account this way: a player joins their campaign with an
 * invite link in a browser first.
 *
 * The session is an ordinary Better Auth session. Only its cookie differs: `SameSite=None;
 * Secure; Partitioned`, which a browser keeps for a page framed by another site (D-48). So
 * every route and the live room work in the frame as they do in a tab, and no token sits in
 * the page's script. The frame's cookie jar is its own (Discord's proxy is another address),
 * so a tab's cookie keeps its stricter attributes.
 *
 * A Better Auth plugin, so the session and its cookie are made by Better Auth's own code, and
 * the route gets Better Auth's rate limit. Better Auth checks a request's origin only when it
 * carries cookies, and a first sign-in carries none, so the route checks it itself: only the
 * app's own address and Discord's proxy for this application may call it. Otherwise another
 * site could sign a visitor's frame in to an account of its choosing.
 */
import {
  ACTIVITY_NO_ACCOUNT,
  ACTIVITY_SIGN_IN_PATH,
  activityTokenRequestSchema,
  activityTokenResponseSchema,
} from '@stagehand/shared';
import type { BetterAuthPlugin } from 'better-auth';
import { APIError, createAuthEndpoint } from 'better-auth/api';
import { setSessionCookie } from 'better-auth/cookies';
import { eq } from 'drizzle-orm';

import type { Database } from '../db/client';
import { users } from '../db/schema';
import type { DiscordProvider } from '../providers/discord';

export interface ActivitySignInOptions {
  db: Database;
  discord: DiscordProvider;
  /** Where Better Auth's routes live (`/api/auth`): the route's path is given without it. */
  basePath: string;
  /** The origins that may sign in: the app's own, and Discord's proxy for this application. */
  origins: readonly string[];
}

/**
 * Most sign-ins from one address in a minute. Inside Discord every player arrives through
 * Discord's proxy, so one address can be a whole table opening the Activity at once.
 */
export const ACTIVITY_SIGN_IN_LIMIT = { window: 60, max: 30 } as const;

export const NO_ACCOUNT_MESSAGE =
  'No Stagehand account goes with this Discord account yet. Sign in to Stagehand in a browser and join your campaign with the invite link from your GM, then open the Activity again.';

export function activitySignIn(options: ActivitySignInOptions): BetterAuthPlugin {
  const path = ACTIVITY_SIGN_IN_PATH.slice(options.basePath.length);

  return {
    id: 'discord-activity',
    endpoints: {
      activitySignIn: createAuthEndpoint(
        path,
        { method: 'POST', body: activityTokenRequestSchema },
        async (ctx) => {
          // A browser always names the origin of a POST; a request without one is not a page.
          const origin = ctx.headers?.get('origin') ?? null;
          if (origin === null || !options.origins.includes(origin)) {
            throw new APIError('FORBIDDEN', { message: 'Cross-origin request blocked' });
          }

          const exchanged = await options.discord.exchangeCode(ctx.body.code);
          if (exchanged.status === 'refused') {
            throw new APIError('BAD_REQUEST', {
              message: `Discord refused the code (${String(exchanged.discordStatus)})`,
            });
          }
          if (exchanged.status !== 'ok') {
            throw new APIError('BAD_GATEWAY', { message: "Couldn't reach Discord" });
          }

          const who = await options.discord.userOf(exchanged.accessToken);
          if (who.status !== 'ok') {
            throw new APIError('BAD_GATEWAY', { message: "Couldn't reach Discord" });
          }

          const [account] = await options.db
            .select({ id: users.id })
            .from(users)
            .where(eq(users.discordId, who.id));
          const user =
            account === undefined
              ? null
              : await ctx.context.internalAdapter.findUserById(account.id);
          if (user === null) {
            throw new APIError('NOT_FOUND', {
              code: ACTIVITY_NO_ACCOUNT,
              message: NO_ACCOUNT_MESSAGE,
            });
          }

          const session = await ctx.context.internalAdapter.createSession(user.id);
          await setSessionCookie(ctx, { session, user }, false, {
            sameSite: 'none',
            secure: true,
            partitioned: true,
          });

          // The Discord token goes back for the SDK's `authenticate`; it is not kept here.
          ctx.setHeader('cache-control', 'no-store');
          return ctx.json(
            activityTokenResponseSchema.parse({
              accessToken: exchanged.accessToken,
              scopes: exchanged.scopes,
            }),
          );
        },
      ),
    },
    rateLimit: [{ pathMatcher: (called) => called === path, ...ACTIVITY_SIGN_IN_LIMIT }],
  };
}
