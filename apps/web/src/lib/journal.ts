/** The player journal's paths and small helpers (F3.5). */

/** The Records page's `?type=` value that shows player entries instead of records. */
export const ENTRIES_FILTER = 'entries';

/**
 * The Records page's search params with the entries filter (`?type=entries`) in front, so a
 * search keeps it.
 */
export function entriesParams(q: string): URLSearchParams {
  const params = new URLSearchParams({ type: ENTRIES_FILTER });
  if (q !== '') params.set('q', q);
  return params;
}

/** A player entry's page. */
export function entryPath(campaignId: string, entryId: string): string {
  return `/campaigns/${campaignId}/entries/${entryId}`;
}

/** The Records page showing player entries. */
export function entriesPath(campaignId: string): string {
  return `/campaigns/${campaignId}/records?type=${ENTRIES_FILTER}`;
}

const postedAt = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/** When a note or entry was posted, as people read it. */
export function postedTime(iso: string): string {
  return postedAt.format(new Date(iso));
}

/** Whether the text matches a search: every word appears in it, ignoring case. */
export function matchesWords(text: string, q: string): boolean {
  const haystack = text.toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word !== '')
    .every((word) => haystack.includes(word));
}
