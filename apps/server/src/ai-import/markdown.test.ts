import { emptyRichText, recordRichTextSchema, type RichText } from '@stagehand/shared';
import { describe, expect, it } from 'vitest';

import {
  markdownToRichText,
  mentionRefsIn,
  mentionsToNames,
  richTextToMarkdown,
  type MentionResolver,
} from './markdown';

const VOSS = '11111111-1111-4111-8111-111111111111';
const MIRA = '22222222-2222-4222-8222-222222222222';

const KNOWN: Record<string, { id: string; label: string }> = {
  E1: { id: VOSS, label: 'Captain Voss' },
  N2: { id: MIRA, label: 'Mira' },
};
const resolve: MentionResolver = (ref) => KNOWN[ref] ?? null;
const refOf = (id: string) =>
  Object.entries(KNOWN).find(([, record]) => record.id === id)?.[0] ?? null;

/** Converts and checks the result is storable. */
function convert(markdown: string): RichText {
  const { doc } = markdownToRichText(markdown, resolve);
  expect(recordRichTextSchema.safeParse(doc).error?.issues ?? []).toEqual([]);
  return doc;
}

const p = (...content: unknown[]) => ({ type: 'paragraph', content });
const t = (text: string, ...marks: string[]) =>
  marks.length === 0
    ? { type: 'text', text }
    : { type: 'text', text, marks: marks.map((type) => ({ type })) };

describe('markdownToRichText', () => {
  it('turns paragraphs into paragraphs', () => {
    expect(convert('One.\n\nTwo.')).toEqual({ type: 'doc', content: [p(t('One.')), p(t('Two.'))] });
  });

  it('gives an empty document for nothing', () => {
    expect(convert('')).toEqual(emptyRichText());
    expect(convert('  \n\n ')).toEqual(emptyRichText());
  });

  it('keeps bold, italic, strike, code and links', () => {
    expect(
      convert('A **bold** and *slanted* and ~~gone~~ and `raw` [site](https://example.test/a).'),
    ).toEqual({
      type: 'doc',
      content: [
        p(
          t('A '),
          t('bold', 'bold'),
          t(' and '),
          t('slanted', 'italic'),
          t(' and '),
          t('gone', 'strike'),
          t(' and '),
          t('raw', 'code'),
          t(' '),
          {
            type: 'text',
            text: 'site',
            marks: [{ type: 'link', attrs: { href: 'https://example.test/a' } }],
          },
          t('.'),
        ),
      ],
    });
  });

  it('nests marks', () => {
    expect(convert('**bold and *both***')).toEqual({
      type: 'doc',
      content: [p(t('bold and ', 'bold'), t('both', 'bold', 'italic'))],
    });
  });

  it('keeps the text of a link it may not store', () => {
    expect(convert('[click](javascript:alert(1)) and [file](ftp://x.test/f)')).toEqual({
      type: 'doc',
      content: [p(t('click and file'))],
    });
  });

  it('limits headings to three levels', () => {
    expect(convert('# One\n\n## Two\n\n##### Five')).toEqual({
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1 }, content: [t('One')] },
        { type: 'heading', attrs: { level: 2 }, content: [t('Two')] },
        { type: 'heading', attrs: { level: 3 }, content: [t('Five')] },
      ],
    });
  });

  it('builds bullet, numbered and nested lists', () => {
    expect(convert('- one\n- two\n  - inner\n\n3. three\n4. four')).toEqual({
      type: 'doc',
      content: [
        {
          type: 'bulletList',
          content: [
            { type: 'listItem', content: [p(t('one'))] },
            {
              type: 'listItem',
              content: [
                p(t('two')),
                { type: 'bulletList', content: [{ type: 'listItem', content: [p(t('inner'))] }] },
              ],
            },
          ],
        },
        {
          type: 'orderedList',
          attrs: { start: 3 },
          content: [
            { type: 'listItem', content: [p(t('three'))] },
            { type: 'listItem', content: [p(t('four'))] },
          ],
        },
      ],
    });
  });

  it('builds quotes and rules', () => {
    expect(convert('> Beware.\n\n---\n\nAfter.')).toEqual({
      type: 'doc',
      content: [
        { type: 'blockquote', content: [p(t('Beware.'))] },
        { type: 'horizontalRule' },
        p(t('After.')),
      ],
    });
  });

  it('treats a single newline as a line break', () => {
    expect(convert('First line\nsecond line')).toEqual({
      type: 'doc',
      content: [p(t('First line'), { type: 'hardBreak' }, t('second line'))],
    });
  });

  it('leaves special characters as they are', () => {
    expect(convert('Salt & iron <cheap> "quoted" 5 > 3')).toEqual({
      type: 'doc',
      content: [p(t('Salt & iron <cheap> "quoted" 5 > 3'))],
    });
    expect(convert('Not \\*starred\\* and 2 \\* 3')).toEqual({
      type: 'doc',
      content: [p(t('Not *starred* and 2 * 3'))],
    });
  });

  it('keeps what has no place in rich text as plain text', () => {
    expect(convert('```\nroll <x>\nagain\n```')).toEqual({
      type: 'doc',
      content: [p(t('roll <x>', 'code'), { type: 'hardBreak' }, t('again', 'code'))],
    });
    expect(convert('| a | b |\n|---|---|\n| 1 | 2 |')).toEqual({
      type: 'doc',
      content: [
        p(
          t('| a | b |'),
          { type: 'hardBreak' },
          t('|---|---|'),
          { type: 'hardBreak' },
          t('| 1 | 2 |'),
        ),
      ],
    });
    expect(convert('<div>boxed</div>')).toEqual({
      type: 'doc',
      content: [p(t('<div>boxed</div>'))],
    });
    expect(convert('![a map](https://example.test/map.png)')).toEqual({
      type: 'doc',
      content: [p(t('a map'))],
    });
  });

  it('turns [[ref]] into a mention of the record', () => {
    expect(convert('Owes money to [[E1]], and hired [[n2]].')).toEqual({
      type: 'doc',
      content: [
        p(
          t('Owes money to '),
          {
            type: 'mention',
            attrs: { id: VOSS, label: 'Captain Voss', mentionSuggestionChar: '@' },
          },
          t(', and hired '),
          { type: 'mention', attrs: { id: MIRA, label: 'Mira', mentionSuggestionChar: '@' } },
          t('.'),
        ),
      ],
    });
  });

  it('reads a mention with a label, inside formatting and before brackets', () => {
    const doc = convert('**Ask [[E1|the captain]]** then [[E1]](again)');
    const mentions = JSON.stringify(doc).match(/"type":"mention"/g) ?? [];
    expect(mentions).toHaveLength(2);
    expect(JSON.stringify(doc)).not.toContain('the captain');
  });

  it('keeps an unknown ref as text and reports it', () => {
    const result = markdownToRichText('Seen with [[E9]] and [[E9]] and [[N7]].', resolve);
    expect(result.unknownMentions).toEqual(['E9', 'N7']);
    expect(result.doc).toEqual({
      type: 'doc',
      content: [p(t('Seen with [[E9]] and [[E9]] and [[N7]].'))],
    });
  });

  it('leaves other double brackets alone', () => {
    expect(convert('The [[old road]] and [[12]].')).toEqual({
      type: 'doc',
      content: [p(t('The [[old road]] and [[12]].'))],
    });
  });

  it('flattens lists nested absurdly deep instead of failing', () => {
    const deep = Array.from(
      { length: 14 },
      (_, level) => `${'  '.repeat(level)}- level ${String(level)}`,
    );
    const doc = convert(deep.join('\n'));
    expect(JSON.stringify(doc)).toContain('level 13');
  });

  it('puts a paragraph first in a list item that starts with a list', () => {
    const doc = convert('- - inner');
    const item = (doc.content[0] as { content: { content: { type: string }[] }[] }).content[0];
    expect(item?.content[0]?.type).toBe('paragraph');
  });
});

describe('richTextToMarkdown', () => {
  it('writes every node and mark', () => {
    const doc: RichText = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'The harbor' }] },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Run by ' },
            { type: 'mention', attrs: { id: VOSS, label: 'Captain Voss' } },
            { type: 'text', text: ', who is ' },
            { type: 'text', text: 'not', marks: [{ type: 'bold' }] },
            { type: 'text', text: ' kind.' },
            { type: 'hardBreak' },
            { type: 'text', text: 'See ' },
            {
              type: 'text',
              text: 'the map',
              marks: [{ type: 'link', attrs: { href: 'https://example.test/map' } }],
            },
            { type: 'text', text: '.' },
          ],
        },
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'nets' }] }],
            },
          ],
        },
        {
          type: 'blockquote',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Mind the tide.' }] }],
        },
        { type: 'horizontalRule' },
      ],
    };
    expect(richTextToMarkdown(doc, refOf)).toBe(
      [
        '## The harbor',
        'Run by [[E1]], who is **not** kind.\nSee [the map](https://example.test/map).',
        '- nets',
        '> Mind the tide.',
        '---',
      ].join('\n\n'),
    );
  });

  it('writes a mention of a record the model was not shown as its name', () => {
    const doc: RichText = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'mention', attrs: { id: MIRA, label: 'Mira [the] *Bold*' } }],
        },
      ],
    };
    expect(richTextToMarkdown(doc)).toBe('Mira \\[the\\] \\*Bold\\*');
  });

  it('writes nothing for an empty document', () => {
    expect(richTextToMarkdown(emptyRichText())).toBe('');
  });
});

describe('round trip', () => {
  const docs: Record<string, RichText> = {
    'marks and mentions': {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Plain ' },
            { type: 'text', text: 'bold', marks: [{ type: 'bold' }] },
            { type: 'text', text: ' ' },
            { type: 'text', text: 'slanted', marks: [{ type: 'italic' }] },
            { type: 'text', text: ' ' },
            { type: 'text', text: 'struck', marks: [{ type: 'strike' }] },
            { type: 'text', text: ' ' },
            { type: 'text', text: 'a*b_c', marks: [{ type: 'code' }] },
            { type: 'text', text: ' with ' },
            {
              type: 'mention',
              attrs: { id: VOSS, label: 'Captain Voss', mentionSuggestionChar: '@' },
            },
            { type: 'hardBreak' },
            { type: 'text', text: 'and a second line.' },
          ],
        },
      ],
    },
    'text that looks like Markdown': {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: '# not a heading' }] },
        { type: 'paragraph', content: [{ type: 'text', text: '- not a list' }] },
        { type: 'paragraph', content: [{ type: 'text', text: '1. not numbered' }] },
        {
          type: 'paragraph',
          content: [{ type: 'text', text: '> not a quote, *not* slanted, [not](a link)' }],
        },
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'a_b_c and 2 * 3 * 4 and `ticks` and <tag> ~~no~~' }],
        },
        { type: 'paragraph', content: [{ type: 'text', text: '---' }] },
      ],
    },
    'blocks inside blocks': {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Top' }] },
        {
          type: 'orderedList',
          attrs: { start: 1 },
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
                      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'inner' }] }],
                    },
                  ],
                },
              ],
            },
            {
              type: 'listItem',
              content: [
                { type: 'paragraph', content: [{ type: 'text', text: 'Second' }] },
                { type: 'paragraph', content: [{ type: 'text', text: 'with more to say' }] },
              ],
            },
          ],
        },
        {
          type: 'blockquote',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'Quoted' }] },
            {
              type: 'bulletList',
              content: [
                {
                  type: 'listItem',
                  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'and listed' }] }],
                },
              ],
            },
          ],
        },
        { type: 'horizontalRule' },
        { type: 'paragraph', content: [{ type: 'text', text: 'End.' }] },
      ],
    },
  };

  it.each(Object.entries(docs))('survives rich text → Markdown → rich text: %s', (_name, doc) => {
    const markdown = richTextToMarkdown(doc, refOf);
    expect(markdownToRichText(markdown, resolve)).toEqual({ doc, unknownMentions: [] });
  });
});

describe('mention helpers', () => {
  it('lists the refs in a text', () => {
    expect(mentionRefsIn('[[E1]] met [[n2]] and [[E1|Voss]] at the [[docks]].')).toEqual([
      'E1',
      'N2',
    ]);
  });

  it('swaps refs for names in plain text', () => {
    expect(mentionsToNames('Sister of [[E1]], enemy of [[E9]].', resolve)).toBe(
      'Sister of Captain Voss, enemy of [[E9]].',
    );
  });
});
