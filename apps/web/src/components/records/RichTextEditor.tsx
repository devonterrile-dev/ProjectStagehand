import { richTextSchema, type RichText } from '@stagehand/shared';
import { EditorContent, useEditor } from '@tiptap/react';
import { useEffect, useRef, useState } from 'react';

import { richTextExtensions } from '@/lib/rich-text-extensions';

import { RichTextToolbar } from './RichTextToolbar';

interface RichTextEditorProps {
  id: string;
  /** Accessible name of the editing area. */
  label: string;
  /** The document to start from. Later changes to this prop are ignored: the editor owns the text. */
  value: RichText;
  editable: boolean;
  /** Called with the whole document after every edit that the schema accepts. */
  onChange: (doc: RichText) => void;
  onBlur?: () => void;
}

/** A TipTap editor limited to the nodes and marks `richTextSchema` stores (D-22). */
export function RichTextEditor({
  id,
  label,
  value,
  editable,
  onChange,
  onBlur,
}: RichTextEditorProps) {
  const onChangeRef = useRef(onChange);
  const onBlurRef = useRef(onBlur);
  const [unsupported, setUnsupported] = useState(false);

  useEffect(() => {
    onChangeRef.current = onChange;
    onBlurRef.current = onBlur;
  });

  // Created once per mount (empty deps): `content` seeds it, and the callbacks go through
  // refs so they never go stale.
  const editor = useEditor(
    {
      extensions: richTextExtensions,
      content: value,
      editable,
      editorProps: {
        attributes: { id, role: 'textbox', 'aria-multiline': 'true', 'aria-label': label },
      },
      onUpdate: ({ editor: current }) => {
        const parsed = richTextSchema.safeParse(current.getJSON());
        if (parsed.success) {
          setUnsupported(false);
          onChangeRef.current(parsed.data);
        } else {
          setUnsupported(true);
        }
      },
      onBlur: () => {
        onBlurRef.current?.();
      },
    },
    [],
  );

  useEffect(() => {
    // `false`: don't emit an update, which would look like an edit to autosave.
    editor.setEditable(editable, false);
  }, [editor, editable]);

  return (
    <div className="rich-text" data-disabled={editable ? undefined : ''}>
      <RichTextToolbar editor={editor} disabled={!editable} />
      <EditorContent editor={editor} />
      {unsupported && (
        <p role="alert" className="px-3 pb-2 text-sm text-destructive">
          This text has formatting Stagehand can&apos;t save.
        </p>
      )}
    </div>
  );
}
