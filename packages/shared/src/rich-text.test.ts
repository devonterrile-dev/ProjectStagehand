import { describe, expect, it } from 'vitest';

import {
  emptyRichText,
  isEmptyRichText,
  RICH_TEXT_MAX_JSON_CHARS,
  richTextSchema,
  richTextToPlainText,
  type RichText,
  type RichTextBlock,
} from './rich-text';

/** Every node and mark the schema allows, with the attrs TipTap emits by default. */
const FULL: RichText = {
  type: 'doc',
  content: [
    {
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: 'The Drowned Market' }],
    },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Stalls float on ' },
        { type: 'text', text: 'barrels', marks: [{ type: 'bold' }, { type: 'italic' }] },
        { type: 'hardBreak' },
        { type: 'text', text: 'see the ', marks: [{ type: 'strike' }] },
        {
          type: 'text',
          text: 'map',
          marks: [
            {
              type: 'link',
              attrs: {
                href: 'https://example.com/map',
                target: '_blank',
                rel: 'noopener noreferrer nofollow',
                class: null,
                title: null,
              },
            },
          ],
        },
        { type: 'text', text: 'ls', marks: [{ type: 'code' }] },
      ],
    },
    {
      type: 'bulletList',
      content: [
        {
          type: 'listItem',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Fish' }] }],
        },
      ],
    },
    {
      type: 'orderedList',
      attrs: { start: 1, type: null },
      content: [
        {
          type: 'listItem',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'First' }] },
            {
              type: 'bulletList',
              content: [
                {
                  type: 'listItem',
                  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Nested' }] }],
                },
              ],
            },
          ],
        },
      ],
    },
    {
      type: 'blockquote',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Quoted' }] }],
    },
    { type: 'horizontalRule' },
    { type: 'paragraph' },
  ],
};

function doc(...content: RichTextBlock[]): RichText {
  return { type: 'doc', content };
}

function paragraph(text: string): RichTextBlock {
  return { type: 'paragraph', content: [{ type: 'text', text }] };
}

/** `levels` bullet lists inside each other, each level two nodes deep (list + item). */
function nestedLists(levels: number): RichTextBlock {
  let block: RichTextBlock = paragraph('deep');
  for (let i = 0; i < levels; i += 1) {
    block = { type: 'bulletList', content: [{ type: 'listItem', content: [block] }] };
  }
  return block;
}

describe('richTextSchema', () => {
  it('accepts every allowed node and mark unchanged', () => {
    expect(richTextSchema.parse(FULL)).toEqual(FULL);
  });

  it('accepts the empty document TipTap produces', () => {
    const empty = emptyRichText();
    expect(richTextSchema.parse(empty)).toEqual(empty);
    expect(isEmptyRichText(empty)).toBe(true);
    expect(isEmptyRichText(doc(paragraph('   ')))).toBe(true);
    expect(isEmptyRichText(doc(paragraph('x')))).toBe(false);
  });

  it.each([
    ['an unknown node', doc({ type: 'image', attrs: { src: 'x.png' } } as never)],
    ['a code block', doc({ type: 'codeBlock', content: [{ type: 'text', text: 'x' }] } as never)],
    [
      'an unknown mark',
      doc({
        type: 'paragraph',
        content: [{ type: 'text', text: 'x', marks: [{ type: 'underline' }] }],
      } as never),
    ],
    ['heading level 4', doc({ type: 'heading', attrs: { level: 4 }, content: [] } as never)],
    ['an unknown attribute', doc({ type: 'paragraph', attrs: { textAlign: 'left' } } as never)],
    ['empty text', doc({ type: 'paragraph', content: [{ type: 'text', text: '' }] })],
    [
      'a javascript: link',
      doc({
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text: 'x',
            marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }],
          },
        ],
      }),
    ],
    [
      'a relative link',
      doc({
        type: 'paragraph',
        content: [{ type: 'text', text: 'x', marks: [{ type: 'link', attrs: { href: '/map' } }] }],
      }),
    ],
    ['an empty document', { type: 'doc', content: [] } as never],
    ['an extra top-level key', { ...emptyRichText(), version: 1 } as never],
    ['a list item outside a list', doc({ type: 'listItem', content: [paragraph('x')] } as never)],
    ['an empty list', doc({ type: 'bulletList', content: [] })],
    ['a non-object', 'plain text' as never],
  ])('rejects %s', (_label, value: RichText) => {
    expect(richTextSchema.safeParse(value).success).toBe(false);
  });

  it('allows deep nesting up to the limit and refuses beyond it', () => {
    expect(richTextSchema.safeParse(doc(nestedLists(10))).success).toBe(true);
    const tooDeep = richTextSchema.safeParse(doc(nestedLists(20)));
    expect(tooDeep.success).toBe(false);
    expect(tooDeep.error?.issues[0]?.message).toBe('Rich text is nested too deeply');
  });

  it('refuses documents over the size limit before parsing them', () => {
    expect(richTextSchema.safeParse(doc(paragraph('a'.repeat(40_000)))).success).toBe(true);
    const huge = richTextSchema.safeParse(doc(paragraph('a'.repeat(RICH_TEXT_MAX_JSON_CHARS))));
    expect(huge.success).toBe(false);
    expect(huge.error?.issues).toHaveLength(1);
  });
});

describe('richTextToPlainText', () => {
  it('keeps the words and turns blocks and hard breaks into newlines', () => {
    expect(richTextToPlainText(FULL)).toBe(
      'The Drowned Market\nStalls float on barrels\nsee the mapls\nFish\nFirst\nNested\nQuoted\n\n',
    );
  });
});
