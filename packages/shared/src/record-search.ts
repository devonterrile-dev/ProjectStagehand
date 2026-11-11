/**
 * Record search (F1.6, D-25): how a search box's text becomes terms, and the short excerpt
 * a result shows. The server matches each term as a word prefix (Postgres full-text search,
 * `simple` config); the web client uses the same terms to bold the matching words.
 */

/** Longest search text the API accepts. */
export const SEARCH_QUERY_MAX = 200;

/** At most this many terms are used; the rest of a long query is ignored. */
export const SEARCH_TERMS_MAX = 10;

/** About how long an excerpt is, in characters, before the `…` marks. */
export const SNIPPET_LENGTH = 140;

/** Characters shown before the matching word, when the text is cut. */
const SNIPPET_LEAD = 40;

const WORD = /[\p{L}\p{N}]+/gu;

/**
 * The query's words, lower-cased, once each, in order: runs of letters and digits, so
 * punctuation never reaches the tsquery. "Mira's guild!" gives `['mira', 's', 'guild']`.
 */
export function searchTerms(query: string): string[] {
  const terms = new Set<string>();
  for (const [word] of query.toLowerCase().matchAll(WORD)) {
    terms.add(word);
    if (terms.size === SEARCH_TERMS_MAX) break;
  }
  return [...terms];
}

/** True when some word of `text` starts with one of the terms. */
export function hasTermPrefix(text: string, terms: readonly string[]): boolean {
  return firstMatch(text, terms) !== null;
}

/** Index of the first word in `text` that starts with one of the terms, or null. */
function firstMatch(text: string, terms: readonly string[]): number | null {
  if (terms.length === 0) return null;
  for (const match of text.matchAll(WORD)) {
    const word = match[0].toLowerCase();
    if (terms.some((term) => word.startsWith(term))) return match.index;
  }
  return null;
}

/**
 * A one-line excerpt of `text` around the first word starting with a term, about
 * `SNIPPET_LENGTH` characters long, with `…` where it was cut. Null when no word matches.
 */
export function snippetAround(text: string, terms: readonly string[]): string | null {
  const flat = text.replace(/\s+/g, ' ').trim();
  const at = firstMatch(flat, terms);
  if (at === null) return null;

  let start = Math.max(0, at - SNIPPET_LEAD);
  let end = Math.min(flat.length, start + SNIPPET_LENGTH);
  start = Math.max(0, Math.min(start, end - SNIPPET_LENGTH));
  // Cut at spaces, so no word is shown half.
  if (start > 0) {
    const space = flat.indexOf(' ', start);
    if (space !== -1 && space < at) start = space + 1;
  }
  if (end < flat.length) {
    const space = flat.lastIndexOf(' ', end);
    if (space > at) end = space;
  }
  return `${start > 0 ? '…' : ''}${flat.slice(start, end).trim()}${end < flat.length ? '…' : ''}`;
}
