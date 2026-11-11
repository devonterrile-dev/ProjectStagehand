import type { ReactNode } from 'react';

const WORD = /[\p{L}\p{N}]+/gu;

/**
 * `text` with every word that starts with a search term in bold, the way the server
 * matches (`searchTerms`, D-25). Plain React text: nothing is parsed as HTML.
 */
export function Highlight({ text, terms }: { text: string; terms: readonly string[] }) {
  if (terms.length === 0) return text;
  const parts: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(WORD)) {
    const word = match[0].toLowerCase();
    if (!terms.some((term) => word.startsWith(term))) continue;
    const start = match.index;
    if (start > last) parts.push(text.slice(last, start));
    parts.push(
      <strong key={start} className="font-semibold text-foreground">
        {match[0]}
      </strong>,
    );
    last = start + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}
