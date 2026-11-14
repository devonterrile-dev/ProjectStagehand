/**
 * Running inside Discord (governance §13): Discord shows an Activity in a frame served from
 * `<client id>.discordsays.com`, its proxy in front of Stagehand. Pure.
 */

/**
 * The path Discord's proxy forwards from. Whether a request from the frame needs it is one of
 * the things the Activity test finds out, so both forms are tried.
 */
export const PROXY_PREFIX = '/.proxy';

export type PathPrefix = '' | typeof PROXY_PREFIX;

/** In the order tried: the plain path first, as in a normal tab. */
export const PATH_PREFIXES: readonly PathPrefix[] = ['', PROXY_PREFIX];

/**
 * Discord launches the frame with a `frame_id` query parameter, which its SDK needs; a normal
 * tab has none.
 */
export function isActivityFrame(search: string): boolean {
  return new URLSearchParams(search).has('frame_id');
}

/** A server path as the frame must ask for it. */
export function withPrefix(prefix: PathPrefix, path: string): string {
  return `${prefix}${path}`;
}
