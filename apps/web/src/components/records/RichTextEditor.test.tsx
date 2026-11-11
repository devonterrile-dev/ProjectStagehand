import {
  recordRichTextSchema,
  richTextSchema,
  type RecordSummary,
  type RichText,
} from '@stagehand/shared';
import type { Editor } from '@tiptap/core';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import { RecordMentionsContext } from '@/lib/record-mentions';

import { RecordNavigationProvider } from './RecordNavigationProvider';
import { RichTextEditor } from './RichTextEditor';

const paragraph = (text: string): RichText => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
});

function renderEditor(editable = true) {
  const onChange = vi.fn<(doc: RichText) => void>();
  const onBlur = vi.fn();
  render(
    <RichTextEditor
      id="notes"
      label="Notes"
      value={paragraph('Stalls float on barrels')}
      editable={editable}
      onChange={onChange}
      onBlur={onBlur}
    />,
  );
  return { onChange, onBlur, area: screen.getByRole('textbox', { name: 'Notes' }) };
}

const lastDoc = (onChange: ReturnType<typeof vi.fn<(doc: RichText) => void>>) =>
  onChange.mock.lastCall?.[0];

describe('RichTextEditor', () => {
  it('turns the current block into a heading and reports a valid document', () => {
    const { onChange } = renderEditor();
    fireEvent.click(screen.getByRole('button', { name: 'Heading 1' }));

    const doc = lastDoc(onChange);
    expect(doc?.content[0]).toMatchObject({ type: 'heading', attrs: { level: 1 } });
    expect(richTextSchema.safeParse(doc).success).toBe(true);
    expect(screen.getByRole('button', { name: 'Heading 1' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
  });

  it('bolds and links a selection', () => {
    const { onChange, area } = renderEditor();
    fireEvent.keyDown(area, { key: 'a', ctrlKey: true });
    fireEvent.click(screen.getByRole('button', { name: 'Bold' }));
    expect(lastDoc(onChange)?.content[0]).toMatchObject({
      type: 'paragraph',
      content: [{ type: 'text', marks: [{ type: 'bold' }] }],
    });

    vi.spyOn(window, 'prompt').mockReturnValue('example.com/map');
    fireEvent.click(screen.getByRole('button', { name: 'Link' }));
    const doc = lastDoc(onChange);
    expect(JSON.stringify(doc)).toContain('"href":"https://example.com/map"');
    expect(richTextSchema.safeParse(doc).success).toBe(true);
  });

  it('tells the parent when focus leaves', () => {
    const { onBlur, area } = renderEditor();
    fireEvent.blur(area);
    expect(onBlur).toHaveBeenCalled();
  });

  it('is read-only when not editable', () => {
    const { area } = renderEditor(false);
    expect(area.getAttribute('contenteditable')).toBe('false');
    expect(screen.getByRole('button', { name: 'Bold' })).toHaveProperty('disabled', true);
  });
});

const summary = (id: string, name: string, type: RecordSummary['type'] = 'npc'): RecordSummary => ({
  id,
  type,
  name,
  tags: [],
  parentId: null,
  parentName: null,
  revealedAt: null,
  createdAt: '2026-11-09T10:00:00.000Z',
  updatedAt: '2026-11-09T10:00:00.000Z',
});

const SELF = 'c3a1b2d4-1111-4a2b-8c3d-000000000001';
const MIRA_ID = 'c3a1b2d4-1111-4a2b-8c3d-000000000002';
const MILLER_ID = 'c3a1b2d4-1111-4a2b-8c3d-000000000003';

/** The editor inside a record form's context, mentioning from three records. */
function renderRecordEditor() {
  const onChange = vi.fn<(doc: RichText) => void>();
  const records = [
    summary(MIRA_ID, 'Mira'),
    summary(SELF, 'Mirror Hall', 'area'),
    summary(MILLER_ID, 'The Miller'),
  ];
  render(
    <MemoryRouter>
      <RecordNavigationProvider campaignId="c1">
        <RecordMentionsContext.Provider
          value={{
            campaignId: 'c1',
            selfId: SELF,
            records,
            byId: new Map(records.map((r) => [r.id, r])),
          }}
        >
          <RichTextEditor
            id="notes"
            label="Notes"
            value={paragraph('Ask ')}
            editable
            onChange={onChange}
          />
        </RecordMentionsContext.Provider>
      </RecordNavigationProvider>
    </MemoryRouter>,
  );
  const area = screen.getByRole('textbox', { name: 'Notes' });
  const editor = (area as HTMLElement & { editor: Editor }).editor;
  return { onChange, area, editor };
}

describe('RichTextEditor mentions', () => {
  it('offers matching records after @, without the record itself, and inserts one', async () => {
    const { onChange, area, editor } = renderRecordEditor();
    act(() => {
      editor.chain().focus('end').insertContent('@Mi').run();
    });

    // The suggestion plugin looks the matches up asynchronously.
    const menu = await screen.findByRole('listbox', { name: 'Mention a record' });
    const options = within(menu).getAllByRole('option');
    expect(options.map((option) => option.firstChild?.textContent)).toEqual(['Mira', 'The Miller']);

    fireEvent.keyDown(area, { key: 'ArrowDown' });
    fireEvent.keyDown(area, { key: 'Enter' });

    const doc = onChange.mock.lastCall?.[0];
    expect(doc?.content[0]).toMatchObject({
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Ask ' },
        { type: 'mention', attrs: { id: MILLER_ID, label: 'The Miller' } },
        { type: 'text', text: ' ' },
      ],
    });
    expect(recordRichTextSchema.safeParse(doc).success).toBe(true);
    expect(screen.queryByRole('listbox', { name: 'Mention a record' })).toBeNull();
    expect(await screen.findByRole('button', { name: '@The Miller' })).toBeDefined();
  });

  it('closes the menu on Escape and keeps the text', async () => {
    const { area, editor } = renderRecordEditor();
    act(() => {
      editor.chain().focus('end').insertContent('@Mi').run();
    });
    expect(await screen.findByRole('listbox', { name: 'Mention a record' })).toBeDefined();
    fireEvent.keyDown(area, { key: 'Escape' });
    expect(screen.queryByRole('listbox', { name: 'Mention a record' })).toBeNull();
    expect(editor.getText()).toBe('Ask @Mi');
  });

  it('has no mentions outside a record form', () => {
    const { onChange, area } = renderEditor();
    const editor = (area as HTMLElement & { editor: Editor }).editor;
    act(() => {
      editor.chain().focus('end').insertContent(' @Mi').run();
    });
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(richTextSchema.safeParse(onChange.mock.lastCall?.[0]).success).toBe(true);
  });
});
