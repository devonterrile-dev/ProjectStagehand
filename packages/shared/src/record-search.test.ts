import { describe, expect, it } from 'vitest';

import {
  hasTermPrefix,
  SEARCH_TERMS_MAX,
  searchTerms,
  SNIPPET_LENGTH,
  snippetAround,
} from './record-search';

describe('searchTerms', () => {
  it('lower-cases runs of letters and digits, once each, in order', () => {
    expect(searchTerms("Mira's  GUILD! guild 3rd")).toEqual(['mira', 's', 'guild', '3rd']);
  });

  it('drops punctuation, so no tsquery syntax gets through', () => {
    expect(searchTerms("a & !b | c:* 'd' (e) \\f %_")).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
    expect(searchTerms('&!:*')).toEqual([]);
  });

  it('keeps letters from any script', () => {
    expect(searchTerms('Ærøskøbing café')).toEqual(['ærøskøbing', 'café']);
  });

  it(`keeps at most ${String(SEARCH_TERMS_MAX)} terms`, () => {
    const words = Array.from({ length: 15 }, (_, i) => `w${String(i)}`);
    expect(searchTerms(words.join(' '))).toEqual(words.slice(0, SEARCH_TERMS_MAX));
  });
});

describe('hasTermPrefix', () => {
  it('is true when a word starts with a term, ignoring case', () => {
    expect(hasTermPrefix('The Tide Guild', ['gui'])).toBe(true);
    expect(hasTermPrefix('The Tide Guild', ['uild'])).toBe(false);
    expect(hasTermPrefix('The Tide Guild', [])).toBe(false);
  });
});

describe('snippetAround', () => {
  it('returns short text whole, with whitespace flattened', () => {
    expect(snippetAround('Owes the\nTide   Guild', ['tide'])).toBe('Owes the Tide Guild');
  });

  it('is null when no word starts with a term', () => {
    expect(snippetAround('Owes the Tide Guild', ['uild'])).toBeNull();
  });

  it('cuts long text around the first match at word boundaries, with ellipses', () => {
    const before = Array.from({ length: 40 }, (_, i) => `before${String(i)}`).join(' ');
    const after = Array.from({ length: 40 }, (_, i) => `after${String(i)}`).join(' ');
    const snippet = snippetAround(`${before} the kraken wakes ${after}`, ['krak']);

    expect(snippet).not.toBeNull();
    const text = snippet ?? '';
    expect(text.startsWith('…before')).toBe(true);
    expect(text.endsWith('…')).toBe(true);
    expect(text).toContain('the kraken wakes');
    expect(text.length).toBeLessThanOrEqual(SNIPPET_LENGTH + 2);
    // No half words at either end.
    for (const word of text.slice(1, -1).split(' ')) {
      expect(word).toMatch(/^(before\d+|after\d+|the|kraken|wakes)$/);
    }
  });

  it('fills the window from earlier text when the match is near the end', () => {
    const before = Array.from({ length: 40 }, (_, i) => `w${String(i)}`).join(' ');
    const snippet = snippetAround(`${before} kraken`, ['kraken']) ?? '';

    expect(snippet.startsWith('…')).toBe(true);
    expect(snippet.endsWith('kraken')).toBe(true);
    expect(snippet.length).toBeGreaterThan(SNIPPET_LENGTH - 20);
  });

  it('starts at the beginning when the match is near it', () => {
    const after = Array.from({ length: 60 }, (_, i) => `w${String(i)}`).join(' ');
    const snippet = snippetAround(`The kraken ${after}`, ['kraken']) ?? '';

    expect(snippet.startsWith('The kraken')).toBe(true);
    expect(snippet.endsWith('…')).toBe(true);
  });
});
