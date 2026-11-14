import { z } from 'zod';

/**
 * The Discord Activity test (governance §13): what the test page and the server's
 * `/api/activity` routes exchange. The routes exist only while `ACTIVITY_TEST=true`.
 */

/** The Discord application's client id. Public: the Embedded App SDK needs it in the browser. */
export const activityConfigResponseSchema = z.object({ clientId: z.string().min(1) });
export type ActivityConfigResponse = z.infer<typeof activityConfigResponseSchema>;

/**
 * What the server saw on a probe request: the headers a cross-origin check would read, and
 * whether the cookie set by the probe before it came back.
 */
export const activityProbeResponseSchema = z.object({
  origin: z.string().nullable(),
  secFetchSite: z.string().nullable(),
  host: z.string().nullable(),
  cookieCameBack: z.boolean(),
});
export type ActivityProbeResponse = z.infer<typeof activityProbeResponseSchema>;

/** Longer than any code Discord issues; a bound, so the route never forwards a huge body. */
export const ACTIVITY_CODE_MAX = 512;

/** The code the Embedded App SDK's `authorize` returned. */
export const activityTokenRequestSchema = z.object({
  code: z.string().min(1).max(ACTIVITY_CODE_MAX),
});
export type ActivityTokenRequest = z.infer<typeof activityTokenRequestSchema>;

/** The user's own Discord access token, which the SDK's `authenticate` needs. */
export const activityTokenResponseSchema = z.object({
  accessToken: z.string().min(1),
  scopes: z.array(z.string()),
});
export type ActivityTokenResponse = z.infer<typeof activityTokenResponseSchema>;

/** The Socket.IO echo the test page uses to check live traffic through Discord's proxy. */
export const ACTIVITY_SOCKET = {
  /** Socket.IO's default path, which live sessions (F3.3) will use too. */
  path: '/socket.io',
  namespace: '/activity-probe',
  /** Sent with a short text; the server answers through the acknowledgement with the same text. */
  echo: 'probe:echo',
  textMax: 64,
} as const;
