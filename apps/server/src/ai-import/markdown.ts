/**
 * Markdown ↔ rich text for the AI import (F1.9, D-27). The model can't write our rich text
 * directly (Anthropic's structured output refuses recursive schemas, and the TipTap document
 * is one), so rich fields travel as Markdown: existing text goes out through
 * `richTextToMarkdown`, the model's text comes back through `markdownToRichText`.
 *
 * The result only ever uses the closed node set of `recordRichTextSchema` (D-22). Markdown
 * that has no place in it (tables, code blocks, images, HTML) is kept as plain text rather
 * than dropped, so the GM still sees what the model wrote.
 *
 * A record is mentioned as `[[ref]]`, where `ref` is the short id the prompt gave it
 * (`E3`, `N1`). The caller resolves refs to records; an unknown ref stays in the text as
 * written and is reported, so the validator can send it back to the model.
 */
import {
  emptyRichText,
  type RichText,
  type RichTextBlock,
  type RichTextInline,
  type RichTextMark,
} from '@stagehand/shared';
import { marked, type Token, type Tokens } from 'marked';

/** A mention's target, or null when the ref names nothing the model was shown. */
export type MentionResolver = (ref: string) => { id: string; label: string } | null;

export interface MarkdownResult {
  doc: RichText;
  /** Refs that named nothing, once each. Their `[[ref]]` text was kept as written. */
  unknownMentions: string[];
}

/** `[[E3]]`, and the `[[E3|Captain Voss]]` some models write. */
const MENTION_TOKEN = /\[\[\s*([A-Za-z]\d+)\s*(?:\|[^\]\n]*)?\]\]/g;
// Private-use characters stand in for the brackets while Markdown is parsed, so `[[E3]]`
// can never be read as link syntax.
const OPEN = String.fromCharCode(0xe000);
const CLOSE = String.fromCharCode(0xe001);
const PLACEHOLDER = new RegExp(`${OPEN}([A-Za-z]\\d+)${CLOSE}`, 'g');
const PRIVATE_USE = new RegExp(`[${OPEN}${CLOSE}]`, 'g');

const LINK_PROTOCOLS = ['http://', 'https://', 'mailto:'];
/** Lists and quotes nested deeper than this are flattened to text (well inside D-22's limit). */
const MAX_NESTING = 8;

/** The mention refs in a piece of model text, upper-cased, once each. */
export function mentionRefsIn(text: string): string[] {
  return [...new Set([...text.matchAll(MENTION_TOKEN)].map((m) => (m[1] ?? '').toUpperCase()))];
}

/** Replaces each `[[ref]]` with the record's name (or leaves it when the ref is unknown). */
export function mentionsToNames(text: string, resolve: MentionResolver): string {
  return text.replace(MENTION_TOKEN, (whole, ref: string) => {
    return resolve(ref.toUpperCase())?.label ?? whole;
  });
}

interface Conversion {
  resolve: MentionResolver;
  unknown: Set<string>;
}

/** Turns the model's Markdown into a rich text document. */
export function markdownToRichText(markdown: string, resolve: MentionResolver): MarkdownResult {
  const conversion: Conversion = { resolve, unknown: new Set() };
  const source = markdown
    .replace(/\r\n?/g, '\n')
    .replace(PRIVATE_USE, '')
    .replace(MENTION_TOKEN, (_whole, ref: string) => `${OPEN}${ref.toUpperCase()}${CLOSE}`);

  // `breaks`: a single newline is a line break, which is what a model that wraps lines means.
  const tokens = marked.lexer(source, { gfm: true, breaks: true });
  const content = blocksOf(tokens, conversion, 0);
  return {
    doc: content.length === 0 ? emptyRichText() : { type: 'doc', content },
    unknownMentions: [...conversion.unknown],
  };
}

type ListItemNode = Extract<RichTextBlock, { type: 'bulletList' }>['content'][number];

function blocksOf(
  tokens: readonly Token[],
  conversion: Conversion,
  depth: number,
): RichTextBlock[] {
  const out: RichTextBlock[] = [];
  for (const token of tokens) {
    switch (token.type) {
      case 'space':
      case 'def':
      case 'checkbox':
        break;
      case 'heading': {
        const content = inlinesOf(token.tokens ?? [], conversion);
        if (content.length === 0) break;
        const level = Math.min(Math.max(Number(token.depth), 1), 3) as 1 | 2 | 3;
        out.push({ type: 'heading', attrs: { level }, content });
        break;
      }
      case 'paragraph':
      case 'text': {
        // A block-level `text` token is a tight list item's line.
        const inline = token.tokens ?? [{ type: 'text', raw: token.raw, text: token.raw }];
        pushParagraph(out, inlinesOf(inline, conversion));
        break;
      }
      case 'hr':
        out.push({ type: 'horizontalRule' });
        break;
      case 'blockquote': {
        if (depth >= MAX_NESTING) {
          pushPlain(out, token.raw);
          break;
        }
        const content = blocksOf(token.tokens ?? [], conversion, depth + 1);
        if (content.length > 0) out.push({ type: 'blockquote', content });
        break;
      }
      case 'list': {
        if (depth >= MAX_NESTING) {
          pushPlain(out, token.raw);
          break;
        }
        const items = (token.items as Tokens.ListItem[]).map((item) =>
          listItemOf(item, conversion, depth),
        );
        if (items.length === 0) break;
        if (token.ordered === true) {
          const start = Number(token.start);
          out.push({
            type: 'orderedList',
            attrs: { start: Number.isInteger(start) && start >= 1 ? start : 1 },
            content: items,
          });
        } else {
          out.push({ type: 'bulletList', content: items });
        }
        break;
      }
      case 'code':
        pushPlain(out, String(token.text ?? token.raw), [{ type: 'code' }]);
        break;
      default:
        // Tables, HTML and anything a later Markdown flavour adds: keep the text.
        pushPlain(out, token.raw);
    }
  }
  return out;
}

function listItemOf(item: Tokens.ListItem, conversion: Conversion, depth: number): ListItemNode {
  const content = blocksOf(item.tokens, conversion, depth + 1);
  // The editor's schema wants a paragraph first in every list item.
  const first = content[0];
  const lead: Extract<RichTextBlock, { type: 'paragraph' }> =
    first?.type === 'paragraph' ? first : { type: 'paragraph' };
  if (first?.type !== 'paragraph') content.unshift(lead);
  if (item.task) {
    const box: RichTextInline = { type: 'text', text: item.checked === true ? '[x] ' : '[ ] ' };
    lead.content = [box, ...(lead.content ?? [])];
  }
  return { type: 'listItem', content };
}

function pushParagraph(out: RichTextBlock[], content: RichTextInline[]): void {
  // A paragraph of nothing but line breaks is nothing.
  if (content.every((node) => node.type === 'hardBreak')) return;
  out.push({ type: 'paragraph', content });
}

/** One paragraph of literal text, its lines kept as line breaks. */
function pushPlain(out: RichTextBlock[], raw: string, marks: RichTextMark[] = []): void {
  const content: RichTextInline[] = [];
  for (const line of raw.replace(PRIVATE_USE, '').split('\n')) {
    if (line.trim() === '') continue;
    if (content.length > 0) content.push({ type: 'hardBreak' });
    content.push(
      marks.length === 0 ? { type: 'text', text: line } : { type: 'text', text: line, marks },
    );
  }
  if (content.length > 0) out.push({ type: 'paragraph', content });
}

function inlinesOf(tokens: readonly Token[], conversion: Conversion): RichTextInline[] {
  const out: RichTextInline[] = [];
  walkInline(tokens, [], out, conversion);
  // Line breaks at either end of a block show as nothing but an odd gap.
  while (out[0]?.type === 'hardBreak') out.shift();
  while (out.at(-1)?.type === 'hardBreak') out.pop();
  return out;
}

function walkInline(
  tokens: readonly Token[],
  marks: readonly RichTextMark[],
  out: RichTextInline[],
  conversion: Conversion,
): void {
  for (const token of tokens) {
    switch (token.type) {
      case 'text':
        if (token.tokens !== undefined && token.tokens.length > 0) {
          walkInline(token.tokens, marks, out, conversion);
        } else {
          pushText(out, String(token.text ?? token.raw), marks, conversion);
        }
        break;
      case 'escape':
        pushText(out, String(token.text ?? token.raw), marks, conversion);
        break;
      case 'strong':
        walkInline(token.tokens ?? [], withMark(marks, { type: 'bold' }), out, conversion);
        break;
      case 'em':
        walkInline(token.tokens ?? [], withMark(marks, { type: 'italic' }), out, conversion);
        break;
      case 'del':
        walkInline(token.tokens ?? [], withMark(marks, { type: 'strike' }), out, conversion);
        break;
      case 'codespan':
        // The editor's code mark excludes every other mark.
        pushText(out, String(token.text ?? ''), [{ type: 'code' }], conversion);
        break;
      case 'br':
        out.push({ type: 'hardBreak' });
        break;
      case 'link': {
        const href = String(token.href ?? '');
        const allowed =
          href.length <= 2000 &&
          LINK_PROTOCOLS.some((protocol) => href.toLowerCase().startsWith(protocol));
        const next = allowed ? withMark(marks, { type: 'link', attrs: { href } }) : marks;
        walkInline(token.tokens ?? [], next, out, conversion);
        break;
      }
      case 'image':
        pushText(out, String(token.text ?? '') || String(token.href ?? ''), marks, conversion);
        break;
      default:
        // Inline HTML and anything unknown: show it as written.
        pushText(out, token.raw, marks, conversion);
    }
  }
}

function withMark(marks: readonly RichTextMark[], mark: RichTextMark): RichTextMark[] {
  return [...marks.filter((existing) => existing.type !== mark.type), mark];
}

const sameMarks = (a: readonly RichTextMark[] | undefined, b: readonly RichTextMark[]) =>
  JSON.stringify(a ?? []) === JSON.stringify(b);

function pushText(
  out: RichTextInline[],
  raw: string,
  marks: readonly RichTextMark[],
  conversion: Conversion,
): void {
  const add = (text: string): void => {
    if (text === '') return;
    const last = out.at(-1);
    if (last?.type === 'text' && sameMarks(last.marks, marks)) {
      last.text += text;
    } else {
      out.push(
        marks.length === 0 ? { type: 'text', text } : { type: 'text', text, marks: [...marks] },
      );
    }
  };

  let from = 0;
  for (const match of raw.matchAll(PLACEHOLDER)) {
    add(raw.slice(from, match.index).replace(/\n/g, ' '));
    from = match.index + match[0].length;
    const ref = match[1] ?? '';
    const target = conversion.resolve(ref);
    if (target === null) {
      conversion.unknown.add(ref);
      add(`[[${ref}]]`);
    } else {
      out.push({
        type: 'mention',
        attrs: { id: target.id, label: target.label, mentionSuggestionChar: '@' },
      });
    }
  }
  add(raw.slice(from).replace(/\n/g, ' '));
}

// ---------------------------------------------------------------------------
// Rich text → Markdown, for showing the model what a record already says.
// ---------------------------------------------------------------------------

/** The ref to write for a mentioned record, or null to write its name as plain text. */
export type MentionRef = (id: string) => string | null;

/** Renders a document as Markdown the model can read and write back. */
export function richTextToMarkdown(doc: RichText, mentionRef: MentionRef = () => null): string {
  return blocksToMarkdown(doc.content, mentionRef).trim();
}

function blocksToMarkdown(blocks: readonly RichTextBlock[], mentionRef: MentionRef): string {
  return blocks
    .map((block) => blockToMarkdown(block, mentionRef))
    .filter((text) => text !== '')
    .join('\n\n');
}

function blockToMarkdown(block: RichTextBlock, mentionRef: MentionRef): string {
  switch (block.type) {
    case 'paragraph':
      return guardLineStarts(inlineToMarkdown(block.content ?? [], mentionRef, '\n'));
    case 'heading':
      // A heading is one line, so its line breaks become spaces.
      return `${'#'.repeat(block.attrs.level)} ${inlineToMarkdown(block.content ?? [], mentionRef, ' ')}`;
    case 'bulletList':
      return block.content
        .map((item) => listItemToMarkdown('- ', item.content, mentionRef))
        .join('\n');
    case 'orderedList': {
      const start = block.attrs?.start ?? 1;
      return block.content
        .map((item, index) =>
          listItemToMarkdown(`${String(start + index)}. `, item.content, mentionRef),
        )
        .join('\n');
    }
    case 'blockquote':
      return blocksToMarkdown(block.content, mentionRef)
        .split('\n')
        .map((line) => (line === '' ? '>' : `> ${line}`))
        .join('\n');
    case 'horizontalRule':
      return '---';
  }
}

function listItemToMarkdown(
  marker: string,
  blocks: readonly RichTextBlock[],
  mentionRef: MentionRef,
): string {
  const parts: string[] = [];
  blocks.forEach((block, index) => {
    const text = blockToMarkdown(block, mentionRef);
    if (text === '') return;
    const previous = blocks[index - 1];
    // A nested list sits right under its line; anything else starts a new paragraph.
    const isList = block.type === 'bulletList' || block.type === 'orderedList';
    const tight = isList && previous?.type === 'paragraph';
    parts.push(parts.length === 0 ? text : `${tight ? '\n' : '\n\n'}${text}`);
  });
  const indent = ' '.repeat(marker.length);
  return parts
    .join('')
    .split('\n')
    .map((line, index) =>
      index === 0 ? `${marker}${line}` : line === '' ? '' : `${indent}${line}`,
    )
    .join('\n');
}

/** Keeps a paragraph line from being read as a heading, list item, quote or rule. */
function guardLineStarts(text: string): string {
  return text
    .split('\n')
    .map((line) =>
      line
        .replace(/^(\s*)([#+-])(?=\s|$)/, '$1\\$2')
        .replace(/^(\s*)(\d+)([.)])(?=\s|$)/, '$1$2\\$3')
        .replace(/^(\s*)([-=]{3,})\s*$/, '$1\\$2'),
    )
    .join('\n');
}

const escapeText = (text: string) => text.replace(/[\\`*_[\]<>~]/g, '\\$&');

function inlineToMarkdown(
  content: readonly RichTextInline[],
  mentionRef: MentionRef,
  lineBreak: string,
): string {
  return content
    .map((node) => {
      switch (node.type) {
        case 'hardBreak':
          return lineBreak;
        case 'mention': {
          const ref = mentionRef(node.attrs.id);
          return ref === null ? escapeText(node.attrs.label) : `[[${ref}]]`;
        }
        case 'text':
          return markedText(node.text, node.marks ?? []);
      }
    })
    .join('');
}

function markedText(text: string, marks: readonly RichTextMark[]): string {
  // Emphasis markers must hug the text, so surrounding whitespace moves outside them.
  const lead = /^\s*/.exec(text)?.[0] ?? '';
  const trail = lead.length === text.length ? '' : (/\s*$/.exec(text)?.[0] ?? '');
  const core = text.slice(lead.length, text.length - trail.length);
  if (core === '') return text;

  const has = (type: RichTextMark['type']) => marks.some((mark) => mark.type === type);
  let out: string;
  if (has('code')) {
    const fence = core.includes('`') ? '``' : '`';
    out = fence === '``' ? `${fence} ${core} ${fence}` : `${fence}${core}${fence}`;
  } else {
    out = escapeText(core);
    if (has('strike')) out = `~~${out}~~`;
    if (has('italic')) out = `*${out}*`;
    if (has('bold')) out = `**${out}**`;
  }
  const link = marks.find((mark) => mark.type === 'link');
  if (link !== undefined)
    out = `[${out}](${link.attrs.href.replace(/[()\s]/g, encodeURIComponent)})`;
  return `${lead}${out}${trail}`;
}
