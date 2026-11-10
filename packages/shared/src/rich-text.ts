/**
 * Rich text (D-22): TipTap/ProseMirror document JSON with a closed set of nodes and marks.
 * Used for public descriptions, GM notes and the rich fields of records. Anything outside
 * this set (unknown nodes, marks or attributes, non-http links) is rejected, so stored text
 * can be rendered without sanitising. `mention` nodes arrive with links in F1.5.
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
export type RichTextInline = RichTextText | RichTextHardBreak;

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

const inlineSchema: z.ZodType<RichTextInline> = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('text'),
    text: z.string().min(1),
    marks: z.array(markSchema).optional(),
  }),
  z.strictObject({ type: z.literal('hardBreak') }),
]);

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
  attrs: z.strictObject({ start: z.int().min(1).optional(), type: z.null().optional() }).optional(),
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

/**
 * A rich text document. The size and depth checks run first, on the raw value, so an
 * oversized or absurdly nested document is refused before the recursive parse.
 */
export const richTextSchema: z.ZodType<RichText> = z
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

/** What TipTap produces for an empty editor: one empty paragraph. */
export function emptyRichText(): RichText {
  return { type: 'doc', content: [{ type: 'paragraph' }] };
}

/** The document's text with formatting dropped; blocks and hard breaks become newlines. */
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
      return (block.content ?? [])
        .map((node) => (node.type === 'text' ? node.text : '\n'))
        .join('');
    case 'bulletList':
    case 'orderedList':
      return block.content.map((item) => item.content.map(blockText).join('\n')).join('\n');
    case 'blockquote':
      return block.content.map(blockText).join('\n');
    case 'horizontalRule':
      return '';
  }
}
