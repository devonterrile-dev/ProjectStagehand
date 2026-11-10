import { richTextSchema, type RichText } from '@stagehand/shared';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

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
