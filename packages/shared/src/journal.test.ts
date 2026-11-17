import { describe, expect, it } from 'vitest';

import {
  createEntryRequestSchema,
  noteRequestSchema,
  updateEntryRequestSchema,
  wasEdited,
} from './journal';
import { withMentionsOnly, type RichText } from './rich-text';

describe('note bodies', () => {
  it('keeps line breaks, as \\n, and trims the ends', () => {
    expect(noteRequestSchema.parse({ body: '  one\r\ntwo\rthree \n' })).toEqual({
      body: 'one\ntwo\nthree',
    });
  });

  it('refuses empty, blank and too-long notes, and extra keys', () => {
    for (const body of ['', ' \n ', 'x'.repeat(501)]) {
      expect(noteRequestSchema.safeParse({ body }).success, JSON.stringify(body)).toBe(false);
    }
    expect(noteRequestSchema.safeParse({ body: 'x'.repeat(500) }).success).toBe(true);
    expect(noteRequestSchema.safeParse({ body: 'ok', recordId: 'x' }).success).toBe(false);
  });
});

describe('player entries', () => {
  it('needs a title; the description may be empty', () => {
    expect(createEntryRequestSchema.parse({ title: ' Map ', description: '' })).toEqual({
      title: 'Map',
      description: '',
    });
    expect(createEntryRequestSchema.safeParse({ title: ' ', description: '' }).success).toBe(false);
    expect(
      createEntryRequestSchema.safeParse({ title: 'Map', description: 'x'.repeat(4001) }).success,
    ).toBe(false);
  });

  it('changes at least one thing', () => {
    expect(updateEntryRequestSchema.safeParse({}).success).toBe(false);
    expect(updateEntryRequestSchema.parse({ description: 'New' })).toEqual({ description: 'New' });
  });
});

describe('wasEdited', () => {
  it('ignores the moment between insert and the first read', () => {
    const at = '2026-11-16T10:00:00.000Z';
    expect(wasEdited({ createdAt: at, updatedAt: '2026-11-16T10:00:00.400Z' })).toBe(false);
    expect(wasEdited({ createdAt: at, updatedAt: '2026-11-16T10:05:00.000Z' })).toBe(true);
  });
});

describe('withMentionsOnly', () => {
  const shown = '00000000-0000-4000-8000-000000000001';
  const hidden = '00000000-0000-4000-8000-000000000002';
  const doc: RichText = {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'mention', attrs: { id: shown, label: 'Maren' } },
          { type: 'text', text: ' and ' },
          { type: 'mention', attrs: { id: hidden, label: 'The queen' }, marks: [{ type: 'bold' }] },
        ],
      },
      {
        type: 'bulletList',
        content: [
          {
            type: 'listItem',
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'mention', attrs: { id: hidden, label: 'The queen' } }],
              },
            ],
          },
        ],
      },
      { type: 'horizontalRule' },
    ],
  };

  it('keeps mentions of records in `keep` and makes the rest plain text, everywhere', () => {
    const cleaned = withMentionsOnly(doc, new Set([shown]));
    expect(JSON.stringify(cleaned)).not.toContain(hidden);
    expect(cleaned.content[0]).toEqual({
      type: 'paragraph',
      content: [
        { type: 'mention', attrs: { id: shown, label: 'Maren' } },
        { type: 'text', text: ' and ' },
        { type: 'text', text: 'The queen', marks: [{ type: 'bold' }] },
      ],
    });
    expect(cleaned.content[1]).toEqual({
      type: 'bulletList',
      content: [
        {
          type: 'listItem',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'The queen' }] }],
        },
      ],
    });
    expect(cleaned.content[2]).toEqual({ type: 'horizontalRule' });
  });
});
