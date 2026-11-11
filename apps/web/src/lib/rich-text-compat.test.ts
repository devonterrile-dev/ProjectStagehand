/**
 * Guards D-22's contract between the editor and storage: everything TipTap produces with
 * our extensions must pass `richTextSchema`, including the attrs it adds by default.
 */
import { emptyRichText, recordRichTextSchema, richTextSchema } from '@stagehand/shared';
import { Editor } from '@tiptap/core';
import { afterEach, describe, expect, it } from 'vitest';

import { mentionNode, normalizeLinkHref, richTextExtensions } from './rich-text-extensions';

const EVERYTHING = `
  <h1>Title</h1><h2>Sub</h2><h3>Third</h3><h4>Fourth</h4>
  <p>Some <strong>bold</strong> <em>italic</em> <s>strike</s> <code>code</code> <u>under</u>
    and <a href="https://example.com/map">a link</a><br>after a break</p>
  <ul><li><p>one</p><ul><li><p>nested</p></li></ul></li></ul>
  <ol start="3"><li><p>three</p></li></ol>
  <blockquote><p>quote</p></blockquote>
  <hr>
  <pre><code>not a code block any more</code></pre>
`;

describe('TipTap output against richTextSchema', () => {
  let editor: Editor;
  const headless = (content?: string) =>
    new Editor({ element: null, extensions: richTextExtensions, content });

  afterEach(() => {
    editor.destroy();
  });

  it('produces only nodes, marks and attrs the schema accepts', () => {
    editor = headless(EVERYTHING);
    const json = editor.getJSON();
    const parsed = richTextSchema.safeParse(json);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);

    const types = JSON.stringify(json);
    expect(types).not.toContain('"codeBlock"');
    expect(types).not.toContain('"underline"');
    expect(types).toContain('"level":1');
    expect(types).not.toContain('"level":4');
    // TipTap's defaults for links are what the schema tolerates on purpose.
    expect(types).toContain('"target":"_blank"');
  });

  it('starts from the same empty document the server stores', () => {
    editor = headless();
    expect(editor.getJSON()).toEqual(emptyRichText());
  });

  it('round-trips a stored document unchanged', () => {
    editor = headless(EVERYTHING);
    const stored = richTextSchema.parse(editor.getJSON());
    editor.commands.setContent(stored);
    expect(editor.getJSON()).toEqual(stored);
  });
});

describe('TipTap mentions against recordRichTextSchema', () => {
  const MIRA = '9f0c2d4e-6a8b-4c1d-8e3f-5a7b9c1d3e5f';
  let editor: Editor;

  afterEach(() => {
    editor.destroy();
  });

  it('stores the id, the label and the @, which only record text accepts', () => {
    editor = new Editor({ element: null, extensions: [...richTextExtensions, mentionNode] });
    editor.commands.setContent({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Ask ' }] }],
    });
    editor.commands.insertContentAt(editor.state.doc.content.size - 1, {
      type: 'mention',
      attrs: { id: MIRA, label: 'Mira' },
    });

    const json = editor.getJSON();
    expect(json.content[0]?.content?.[1]).toEqual({
      type: 'mention',
      attrs: { id: MIRA, label: 'Mira', mentionSuggestionChar: '@' },
    });
    const stored = recordRichTextSchema.parse(json);
    expect(richTextSchema.safeParse(json).success).toBe(false);
    expect(editor.getText()).toBe('Ask @Mira');

    editor.commands.setContent(stored);
    expect(editor.getJSON()).toEqual(stored);
  });
});

describe('normalizeLinkHref', () => {
  it('adds https:// to bare hosts and refuses other schemes', () => {
    expect(normalizeLinkHref('example.com/map')).toBe('https://example.com/map');
    expect(normalizeLinkHref(' http://example.com ')).toBe('http://example.com');
    expect(normalizeLinkHref('mailto:gm@example.com')).toBe('mailto:gm@example.com');
    expect(normalizeLinkHref('javascript:alert(1)')).toBeNull();
    expect(normalizeLinkHref('')).toBeNull();
  });
});
