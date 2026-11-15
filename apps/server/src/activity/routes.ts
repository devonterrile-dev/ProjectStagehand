import { randomBytes } from 'node:crypto';

import {
  activityConfigResponseSchema,
  activityProbeResponseSchema,
  activityTokenRequestSchema,
  activityTokenResponseSchema,
  type ActivityConfigResponse,
  type ActivityProbeResponse,
} from '@stagehand/shared';
import type { FastifyInstance } from 'fastify';

import { sendValidationError } from '../http/errors';
import { createDiscordProvider } from '../providers/discord';

/** Everything the Activity test serves. None of it reads or sets a Stagehand session. */
export const ACTIVITY_PREFIX = '/api/activity/';

export const PROBE_COOKIE = 'stagehand_activity_probe';
const PROBE_COOKIE_SECONDS = 600;

export interface ActivityDeps {
  /** The same Discord application that signs users in (F0.4). */
  discord: { clientId: string; clientSecret: string };
}

const header = (value: string | string[] | undefined): string | null =>
  typeof value === 'string' ? value : null;

function hasCookie(cookieHeader: string | undefined, name: string): boolean {
  return (cookieHeader ?? '').split(';').some((pair) => pair.trim().startsWith(`${name}=`));
}

/**
 * What the page in Discord's frame asks first (governance §13): the Discord client id its SDK
 * needs, and what this server lets the frame do. Served when the Activity (`ACTIVITY`) or its
 * test (`ACTIVITY_TEST`) is on.
 */
export function registerActivityConfigRoute(
  app: FastifyInstance,
  config: { clientId: string; signIn: boolean; test: boolean },
): void {
  app.get(`${ACTIVITY_PREFIX}config`, (): ActivityConfigResponse =>
    activityConfigResponseSchema.parse(config),
  );
}

/**
 * The Discord Activity test's routes (governance §13, the spike after F3.1, D-48). They found
 * out what Discord's proxy does to requests, cookies and sign-in before live sessions were
 * built on it, and stay for the clients not tried yet. Registered only when
 * `ACTIVITY_TEST=true`, which the live site never sets: the token route has no rate limit.
 * Signing in for real is `auth/activity-plugin.ts`.
 */
export function registerActivityRoutes(app: FastifyInstance, deps: ActivityDeps): void {
  const discord = createDiscordProvider(deps.discord);

  // Reports the headers a cross-origin check reads, and tests whether a cookie that is
  // allowed inside another site's frame (SameSite=None; Partitioned) survives the round trip.
  app.post(`${ACTIVITY_PREFIX}probe`, (request, reply): ActivityProbeResponse => {
    const cookieCameBack = hasCookie(request.headers.cookie, PROBE_COOKIE);
    void reply.header(
      'set-cookie',
      `${PROBE_COOKIE}=${randomBytes(12).toString('base64url')}; Path=/; ` +
        `Max-Age=${String(PROBE_COOKIE_SECONDS)}; HttpOnly; Secure; SameSite=None; Partitioned`,
    );
    return activityProbeResponseSchema.parse({
      origin: header(request.headers.origin),
      secFetchSite: header(request.headers['sec-fetch-site']),
      host: header(request.headers.host),
      cookieCameBack,
    });
  });

  // Inside Discord there is no redirect: the SDK's `authorize` hands the page a code, the
  // server exchanges it (the client secret never leaves the server), and the page gives the
  // token to the SDK's `authenticate`. The token is the user's own; it is not stored or logged.
  app.post(`${ACTIVITY_PREFIX}token`, async (request, reply) => {
    const parsed = activityTokenRequestSchema.safeParse(request.body);
    if (!parsed.success) return sendValidationError(reply, parsed.error);

    const exchanged = await discord.exchangeCode(parsed.data.code);
    if (exchanged.status === 'refused') {
      // Discord's own words could quote the code; its status says enough.
      request.log.info(
        { discordStatus: exchanged.discordStatus },
        'discord refused an activity code',
      );
      return reply.code(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: `Discord refused the code (${String(exchanged.discordStatus)})`,
      });
    }
    if (exchanged.status !== 'ok') {
      return reply.code(502).send({
        statusCode: 502,
        error: 'Bad Gateway',
        message:
          exchanged.status === 'unreachable'
            ? "Couldn't reach Discord"
            : "Discord's answer had no access token",
      });
    }
    void reply.header('cache-control', 'no-store');
    return activityTokenResponseSchema.parse({
      accessToken: exchanged.accessToken,
      scopes: exchanged.scopes,
    });
  });
}
