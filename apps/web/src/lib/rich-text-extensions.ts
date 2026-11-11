/**
 * The TipTap extensions behind every rich text field. They produce exactly the nodes and
 * marks `richTextSchema` accepts (D-22): StarterKit without code blocks and underline,
 * headings 1–3, and links limited to http(s) and mailto.
 */
import { mergeAttributes } from '@tiptap/core';
import Mention from '@tiptap/extension-mention';
import StarterKit from '@tiptap/starter-kit';

/** Links Stagehand stores: absolute http(s) or mailto, as `richTextSchema` requires. */
export const LINK_PATTERN = /^(https?:\/\/|mailto:)/i;

export const richTextExtensions = [
  StarterKit.configure({
    heading: { levels: [1, 2, 3] },
    codeBlock: false,
    underline: false,
    link: {
      openOnClick: false,
      defaultProtocol: 'https',
      shouldAutoLink: (url) => LINK_PATTERN.test(url),
      isAllowedUri: (url, context) =>
        context.defaultValidate(url) &&
        LINK_PATTERN.test(url.includes(':') ? url : `${context.defaultProtocol}://${url}`),
    },
  }),
];

/**
 * The @-mention node (D-24), for record text only: it stores the record's `id` and its
 * `label` (the name when mentioned), as `recordRichTextSchema` expects. Backspace removes
 * the whole mention. As plain text or copied HTML it reads `@Name`. The record editor
 * extends it with a chip view and the suggestion menu (`lib/record-mentions.tsx`).
 */
export const mentionNode = Mention.configure({
  deleteTriggerWithBackspace: true,
  renderText: ({ node }) => `@${String(node.attrs['label'] ?? '')}`,
  renderHTML: ({ node, options }) => [
    'span',
    mergeAttributes({ 'data-type': 'mention', class: 'mention' }, options.HTMLAttributes),
    `@${String(node.attrs['label'] ?? '')}`,
  ],
});

/**
 * What the GM typed into the link prompt, as a storable href: `https://` is added when
 * there is no scheme. Null when it still isn't an http(s) or mailto link.
 */
export function normalizeLinkHref(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed === '') return null;
  const href = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
  return LINK_PATTERN.test(href) ? href : null;
}
