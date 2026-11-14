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
import { z } from 'zod';

import { sendValidationError } from '../http/errors';

/** Everything the Activity test serves. None of it reads or sets a Stagehand session. */
export const ACTIVITY_PREFIX = '/api/activity/';

const DISCORD_TOKEN_URL = 'https://discord.com/api/oauth2/token';
const DISCORD_TIMEOUT_MS = 10_000;

export const PROBE_COOKIE = 'stagehand_activity_probe';
const PROBE_COOKIE_SECONDS = 600;

export interface ActivityDeps {
  /** The same Discord application that signs users in (F0.4). */
  discord: { clientId: string; clientSecret: string };
}

/** What Discord answers a code exchange with; only these two fields are used. */
const discordTokenSchema = z.object({ access_token: z.string().min(1), scope: z.string() });

const header = (value: string | string[] | undefined): string | null =>
  typeof value === 'string' ? value : null;

function hasCookie(cookieHeader: string | undefined, name: string): boolean {
  return (cookieHeader ?? '').split(';').some((pair) => pair.trim().startsWith(`${name}=`));
}

/**
 * The Discord Activity test's routes (governance §13, the spike after F3.1). They exist to
 * find out what Discord's proxy does to requests, cookies and sign-in, before live sessions
 * (F3.3) and speaking detection (F3.9) are built on it. Registered only when
 * `ACTIVITY_TEST=true`.
 */
export function registerActivityRoutes(app: FastifyInstance, deps: ActivityDeps): void {
  app.get(`${ACTIVITY_PREFIX}config`, (): ActivityConfigResponse =>
    activityConfigResponseSchema.parse({ clientId: deps.discord.clientId }),
  );

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

    let response: Response;
    try {
      response = await fetch(DISCORD_TOKEN_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: deps.discord.clientId,
          client_secret: deps.discord.clientSecret,
          grant_type: 'authorization_code',
          code: parsed.data.code,
        }),
        signal: AbortSignal.timeout(DISCORD_TIMEOUT_MS),
      });
    } catch {
      return reply
        .code(502)
        .send({ statusCode: 502, error: 'Bad Gateway', message: "Couldn't reach Discord" });
    }

    if (!response.ok) {
      // Discord's own words could quote the code; its status says enough.
      request.log.info({ discordStatus: response.status }, 'discord refused an activity code');
      return reply.code(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: `Discord refused the code (${String(response.status)})`,
      });
    }

    const token = discordTokenSchema.safeParse(await response.json().catch(() => null));
    if (!token.success) {
      return reply.code(502).send({
        statusCode: 502,
        error: 'Bad Gateway',
        message: "Discord's answer had no access token",
      });
    }
    void reply.header('cache-control', 'no-store');
    return activityTokenResponseSchema.parse({
      accessToken: token.data.access_token,
      scopes: token.data.scope.split(' ').filter((scope) => scope !== ''),
    });
  });
}
