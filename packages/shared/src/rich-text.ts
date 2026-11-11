/**
 * Rich text (D-22): TipTap/ProseMirror document JSON with a closed set of nodes and marks.
 * Used for public descriptions, GM notes and the rich fields of records. Anything outside
 * this set (unknown nodes, marks or attributes, non-http links) is rejected, so stored text
 * can be rendered without sanitising.
 *
 * There are two schemas. `recordRichTextSchema` (record text: public description, GM notes,
 * rich fields) also allows `mention` nodes, @-links to another record of the campaign
 * (F1.5, D-24). `richTextSchema` (character sheets, stat blocks) refuses them, so a player's
 * own sheet can never carry a record's id.
 *
 * The optional nullable attrs (`orderedList.attrs.type`, `link.attrs.target/rel/class`) are
 * there because TipTap's `getJSON()` emits them with default values.
 */
import { z } from 'zod';

/** Longest serialized document allowed, in JSON characters (roughly 7,000 words). */
export const RICH_TEXT_MAX_JSON_CHARS = 50_000;
/** Deepest nesting allowed (a list inside a list inside a blockquote…). */
export const RICH_TEXT_MAX_DEPTH = 32;

export type RichTextMark =
  | { type: 'bold' }
  | { type: 'italic' }
  | { type: 'strike' }
  | { type: 'code' }
  | {
      type: 'link';
      attrs: {
        href: string;
        target?: string | null;
        rel?: string | null;
        class?: null;
        title?: string | null;
      };
    };

export interface RichTextText {
  type: 'text';
  text: string;
  marks?: RichTextMark[];
}
export interface RichTextHardBreak {
  type: 'hardBreak';
}
/**
 * An @-mention of a record (records only, D-24). `label` is the record's name when the
 * mention was made; renames don't rewrite it. `id` may point at a record that has since been
 * deleted, which then shows as plain text.
 */
export interface RichTextMention {
  type: 'mention';
  attrs: { id: string; label: string; mentionSuggestionChar?: '@' };
  marks?: RichTextMark[];
}
/** Inline nodes. `mention` only passes `recordRichTextSchema`. */
export type RichTextInline = RichTextText | RichTextHardBreak | RichTextMention;

export interface RichTextParagraph {
  type: 'paragraph';
  content?: RichTextInline[];
}
export interface RichTextHeading {
  type: 'heading';
  attrs: { level: 1 | 2 | 3 };
  content?: RichTextInline[];
}
/** Only valid inside a list, so not a `RichTextBlock`. */
export interface RichTextListItem {
  type: 'listItem';
  content: RichTextBlock[];
}
export interface RichTextBulletList {
  type: 'bulletList';
  content: RichTextListItem[];
}
export interface RichTextOrderedList {
  type: 'orderedList';
  attrs?: { start?: number; type?: null };
  content: RichTextListItem[];
}
export interface RichTextBlockquote {
  type: 'blockquote';
  content: RichTextBlock[];
}
export interface RichTextHorizontalRule {
  type: 'horizontalRule';
}
export type RichTextBlock =
  | RichTextParagraph
  | RichTextHeading
  | RichTextBulletList
  | RichTextOrderedList
  | RichTextBlockquote
  | RichTextHorizontalRule;

/** A rich text document. */
export interface RichText {
  type: 'doc';
  content: RichTextBlock[];
}

const LINK_PROTOCOLS = ['http://', 'https://', 'mailto:'];

const linkHrefSchema = z
  .string()
  .max(2000, 'Links must be 2000 characters or fewer')
  .refine(
    (href) => LINK_PROTOCOLS.some((protocol) => href.toLowerCase().startsWith(protocol)),
    'Links must start with http://, https:// or mailto:',
  );

const markSchema: z.ZodType<RichTextMark> = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('bold') }),
  z.strictObject({ type: z.literal('italic') }),
  z.strictObject({ type: z.literal('strike') }),
  z.strictObject({ type: z.literal('code') }),
  z.strictObject({
    type: z.literal('link'),
    attrs: z.strictObject({
      href: linkHrefSchema,
      target: z.string().nullable().optional(),
      rel: z.string().nullable().optional(),
      class: z.null().optional(),
      title: z.string().nullable().optional(),
    }),
  }),
]);

/** Longest mention label kept in the text: the longest record name (`RECORD_NAME_MAX`). */
export const MENTION_LABEL_MAX = 120;

const textSchema = z.strictObject({
  type: z.literal('text'),
  text: z.string().min(1),
  marks: z.array(markSchema).optional(),
});
const hardBreakSchema = z.strictObject({ type: z.literal('hardBreak') });
const mentionSchema = z.strictObject({
  type: z.literal('mention'),
  attrs: z.strictObject({
    id: z.uuid('A mention must point at a record'),
    label: z
      .string()
      .min(1, 'A mention needs a label')
      .max(
        MENTION_LABEL_MAX,
        `Mention labels must be ${String(MENTION_LABEL_MAX)} characters or fewer`,
      ),
    mentionSuggestionChar: z.literal('@').optional(),
  }),
  marks: z.array(markSchema).optional(),
});

/** The block and document schemas over one set of inline nodes. */
function documentSchemaOver(inlineSchema: z.ZodType<RichTextInline>): z.ZodType<RichText> {
  // Blocks are recursive (blockquotes and list items hold blocks), hence the lazy union.
  const blockSchema: z.ZodType<RichTextBlock> = z.lazy(() =>
    z.discriminatedUnion('type', [
      paragraphSchema,
      headingSchema,
      bulletListSchema,
      orderedListSchema,
      blockquoteSchema,
      horizontalRuleSchema,
    ]),
  );

  const paragraphSchema = z.strictObject({
    type: z.literal('paragraph'),
    content: z.array(inlineSchema).optional(),
  });
  const headingSchema = z.strictObject({
    type: z.literal('heading'),
    attrs: z.strictObject({ level: z.union([z.literal(1), z.literal(2), z.literal(3)]) }),
    content: z.array(inlineSchema).optional(),
  });
  const listItemSchema = z.strictObject({
    type: z.literal('listItem'),
    content: z.array(blockSchema).min(1),
  });
  const bulletListSchema = z.strictObject({
    type: z.literal('bulletList'),
    content: z.array(listItemSchema).min(1),
  });
  const orderedListSchema = z.strictObject({
    type: z.literal('orderedList'),
    attrs: z
      .strictObject({ start: z.int().min(1).optional(), type: z.null().optional() })
      .optional(),
    content: z.array(listItemSchema).min(1),
  });
  const blockquoteSchema = z.strictObject({
    type: z.literal('blockquote'),
    content: z.array(blockSchema).min(1),
  });
  const horizontalRuleSchema = z.strictObject({ type: z.literal('horizontalRule') });

  const docSchema = z.strictObject({
    type: z.literal('doc'),
    content: z.array(blockSchema).min(1, 'Rich text needs at least one block'),
  });

  // The size and depth checks run first, on the raw value, so an oversized or absurdly
  // nested document is refused before the recursive parse.
  return z
    .unknown()
    .superRefine((value, ctx) => {
      if (value === undefined) return;
      if (JSON.stringify(value).length > RICH_TEXT_MAX_JSON_CHARS) {
        ctx.addIssue({
          code: 'custom',
          message: `Rich text must be ${String(RICH_TEXT_MAX_JSON_CHARS)} characters or fewer as JSON`,
        });
        return;
      }
      const stack: { node: unknown; depth: number }[] = [{ node: value, depth: 0 }];
      for (let next = stack.pop(); next !== undefined; next = stack.pop()) {
        if (next.depth > RICH_TEXT_MAX_DEPTH) {
          ctx.addIssue({ code: 'custom', message: 'Rich text is nested too deeply' });
          return;
        }
        if (typeof next.node !== 'object' || next.node === null) continue;
        const { content } = next.node as { content?: unknown };
        if (!Array.isArray(content)) continue;
        for (const child of content) stack.push({ node: child, depth: next.depth + 1 });
      }
    })
    .pipe(docSchema);
}

/**
 * A rich text document without mentions: character sheets and stat blocks. A `mention`
 * node is refused.
 */
export const richTextSchema: z.ZodType<RichText> = documentSchemaOver(
  z.discriminatedUnion('type', [textSchema, hardBreakSchema]),
);

/** A record's rich text: the same nodes plus `mention` (D-24). */
export const recordRichTextSchema: z.ZodType<RichText> = documentSchemaOver(
  z.discriminatedUnion('type', [textSchema, hardBreakSchema, mentionSchema]),
);

/** What TipTap produces for an empty editor: one empty paragraph. */
export function emptyRichText(): RichText {
  return { type: 'doc', content: [{ type: 'paragraph' }] };
}

/**
 * The document's text with formatting dropped; blocks and hard breaks become newlines and a
 * mention becomes its label.
 */
export function richTextToPlainText(doc: RichText): string {
  return doc.content.map(blockText).join('\n');
}

/** True when the document has no text at all (whitespace doesn't count). */
export function isEmptyRichText(doc: RichText): boolean {
  return richTextToPlainText(doc).trim() === '';
}

function blockText(block: RichTextBlock): string {
  switch (block.type) {
    case 'paragraph':
    case 'heading':
      return (block.content ?? []).map(inlineText).join('');
    case 'bulletList':
    case 'orderedList':
      return block.content.map((item) => item.content.map(blockText).join('\n')).join('\n');
    case 'blockquote':
      return block.content.map(blockText).join('\n');
    case 'horizontalRule':
      return '';
  }
}

function inlineText(node: RichTextInline): string {
  switch (node.type) {
    case 'text':
      return node.text;
    case 'mention':
      return node.attrs.label;
    case 'hardBreak':
      return '\n';
  }
}

/** The ids of every record the document mentions, once each, in document order. */
export function mentionIdsOf(doc: RichText): string[] {
  const ids = new Set<string>();
  const visit = (block: RichTextBlock): void => {
    switch (block.type) {
      case 'paragraph':
      case 'heading':
        for (const node of block.content ?? []) {
          if (node.type === 'mention') ids.add(node.attrs.id);
        }
        return;
      case 'bulletList':
      case 'orderedList':
        for (const item of block.content) item.content.forEach(visit);
        return;
      case 'blockquote':
        block.content.forEach(visit);
        return;
      case 'horizontalRule':
        return;
    }
  };
  doc.content.forEach(visit);
  return [...ids];
}
