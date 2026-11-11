import { recordRichTextSchema, richTextSchema, type RichText } from '@stagehand/shared';
import { EditorContent, useEditor } from '@tiptap/react';
import { useContext, useEffect, useRef, useState, useSyncExternalStore } from 'react';

import { MentionMenuStore } from '@/lib/mention-menu-store';
import { RecordMentionsContext, recordMentionExtension } from '@/lib/record-mentions';
import { richTextExtensions } from '@/lib/rich-text-extensions';

import { MentionChip } from './MentionChip';
import { MentionMenu } from './MentionMenu';
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

/**
 * A TipTap editor limited to the nodes and marks Stagehand stores (D-22). Inside a record
 * form (`RecordMentionsContext`) it also offers @-mentions of the campaign's records
 * (D-24) and checks with `recordRichTextSchema`; anywhere else mentions don't exist.
 */
export function RichTextEditor({
  id,
  label,
  value,
  editable,
  onChange,
  onBlur,
}: RichTextEditorProps) {
  const mentions = useContext(RecordMentionsContext);
  const onChangeRef = useRef(onChange);
  const onBlurRef = useRef(onBlur);
  const [unsupported, setUnsupported] = useState(false);
  // The @ menu's state, driven by the suggestion plugin from outside React.
  const [menuStore] = useState(() => new MentionMenuStore(mentions));
  const { menu, active } = useSyncExternalStore(menuStore.subscribe, menuStore.getSnapshot);

  useEffect(() => {
    onChangeRef.current = onChange;
    onBlurRef.current = onBlur;
    menuStore.setMentions(mentions);
  });

  // Created once per mount (empty deps): `content` seeds it, and the callbacks go through
  // refs so they never go stale. Whether mentions exist is fixed for the editor's life.
  const withMentions = mentions !== null;
  const schema = withMentions ? recordRichTextSchema : richTextSchema;
  const editor = useEditor(
    {
      extensions: withMentions
        ? [
            ...richTextExtensions,
            recordMentionExtension(menuStore.currentMentions, menuStore, MentionChip),
          ]
        : richTextExtensions,
      content: value,
      editable,
      editorProps: {
        attributes: { id, role: 'textbox', 'aria-multiline': 'true', 'aria-label': label },
      },
      onUpdate: ({ editor: current }) => {
        const parsed = schema.safeParse(current.getJSON());
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
      {menu !== null && (
        <MentionMenu state={menu} active={active} onActivate={menuStore.activate} />
      )}
      {unsupported && (
        <p role="alert" className="px-3 pb-2 text-sm text-destructive">
          This text has formatting Stagehand can&apos;t save.
        </p>
      )}
    </div>
  );
}
