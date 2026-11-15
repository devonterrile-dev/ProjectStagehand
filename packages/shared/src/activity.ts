import { z } from 'zod';

/**
 * Running inside Discord as an Activity (governance §13): what the page in Discord's frame and
 * the server exchange. Two settings switch it on: `ACTIVITY=true` for signing in and playing
 * there (F3.3c, D-51), and `ACTIVITY_TEST=true` for the test page's probes (D-48), which never
 * runs on the live site.
 */

/**
 * The origin of the page Discord shows an Activity in: its proxy, in front of Stagehand. Every
 * request from the frame names it, so it is what the server's origin checks allow (§14).
 */
export function discordActivityOrigin(clientId: string): string {
  return `https://${clientId}.discordsays.com`;
}

/**
 * `GET /api/activity/config`: served when either setting is on.
 * - `clientId`: the Discord application's client id. Public: the Embedded App SDK needs it in
 *   the browser.
 * - `signIn`: the frame can sign in and play (`ACTIVITY`).
 * - `test`: the test page's probes are served (`ACTIVITY_TEST`).
 */
export const activityConfigResponseSchema = z.object({
  clientId: z.string().min(1),
  signIn: z.boolean().default(false),
  test: z.boolean().default(false),
});
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

/**
 * Signing in inside Discord's frame (F3.3c, D-51). There is no redirect there: the SDK's
 * `authorize` hands the page a code, and the page posts it here (`activityTokenRequestSchema`).
 * The server exchanges it, finds the Stagehand account of that Discord user, and answers with
 * `activityTokenResponseSchema` and a Stagehand session cookie the frame may keep
 * (`SameSite=None; Secure; Partitioned`). One of Better Auth's routes, so it checks the
 * request's origin and limits how often it may be called.
 */
export const ACTIVITY_SIGN_IN_PATH = '/api/auth/activity/sign-in';

/**
 * The `code` of the 404 that sign-in answers when the Discord user has no Stagehand account:
 * they sign in and join their campaign in a browser first (an invite can't be opened in the
 * frame).
 */
export const ACTIVITY_NO_ACCOUNT = 'NO_STAGEHAND_ACCOUNT';

/** The Socket.IO echo the test page uses to check live traffic through Discord's proxy. */
export const ACTIVITY_SOCKET = {
  /** Socket.IO's default path, which the live room uses too. */
  path: '/socket.io',
  namespace: '/activity-probe',
  /** Sent with a short text; the server answers through the acknowledgement with the same text. */
  echo: 'probe:echo',
  textMax: 64,
} as const;
