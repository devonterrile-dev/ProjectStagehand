import type { Editor } from '@tiptap/core';
import { useEditorState } from '@tiptap/react';
import {
  BoldIcon,
  CodeIcon,
  Heading1Icon,
  Heading2Icon,
  Heading3Icon,
  ItalicIcon,
  LinkIcon,
  ListIcon,
  ListOrderedIcon,
  StrikethroughIcon,
  TextQuoteIcon,
  type LucideIcon,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { normalizeLinkHref } from '@/lib/rich-text-extensions';

interface ToolbarButton {
  label: string;
  icon: LucideIcon;
  pressed: boolean;
  run: () => void;
}

/**
 * The formatting buttons above a rich text field. Active state comes from
 * `useEditorState`: TipTap 3 doesn't re-render on every transaction by itself.
 */
export function RichTextToolbar({ editor, disabled }: { editor: Editor; disabled: boolean }) {
  const active = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      bold: current.isActive('bold'),
      italic: current.isActive('italic'),
      strike: current.isActive('strike'),
      code: current.isActive('code'),
      h1: current.isActive('heading', { level: 1 }),
      h2: current.isActive('heading', { level: 2 }),
      h3: current.isActive('heading', { level: 3 }),
      bulletList: current.isActive('bulletList'),
      orderedList: current.isActive('orderedList'),
      blockquote: current.isActive('blockquote'),
      link: current.isActive('link'),
    }),
  });

  function editLink() {
    const attrs = editor.getAttributes('link') as { href?: unknown };
    const current = typeof attrs.href === 'string' ? attrs.href : '';
    const input = window.prompt('Link URL', current);
    if (input === null) return;

    const chain = editor.chain().focus().extendMarkRange('link');
    if (input.trim() === '') {
      chain.unsetLink().run();
      return;
    }
    const href = normalizeLinkHref(input);
    if (href === null) {
      window.alert('Links must start with http://, https:// or mailto:');
      return;
    }
    chain.setLink({ href }).run();
  }

  const buttons: ToolbarButton[] = [
    {
      label: 'Bold',
      icon: BoldIcon,
      pressed: active.bold,
      run: () => editor.chain().focus().toggleBold().run(),
    },
    {
      label: 'Italic',
      icon: ItalicIcon,
      pressed: active.italic,
      run: () => editor.chain().focus().toggleItalic().run(),
    },
    {
      label: 'Strikethrough',
      icon: StrikethroughIcon,
      pressed: active.strike,
      run: () => editor.chain().focus().toggleStrike().run(),
    },
    {
      label: 'Code',
      icon: CodeIcon,
      pressed: active.code,
      run: () => editor.chain().focus().toggleCode().run(),
    },
    {
      label: 'Heading 1',
      icon: Heading1Icon,
      pressed: active.h1,
      run: () => editor.chain().focus().toggleHeading({ level: 1 }).run(),
    },
    {
      label: 'Heading 2',
      icon: Heading2Icon,
      pressed: active.h2,
      run: () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
    },
    {
      label: 'Heading 3',
      icon: Heading3Icon,
      pressed: active.h3,
      run: () => editor.chain().focus().toggleHeading({ level: 3 }).run(),
    },
    {
      label: 'Bullet list',
      icon: ListIcon,
      pressed: active.bulletList,
      run: () => editor.chain().focus().toggleBulletList().run(),
    },
    {
      label: 'Numbered list',
      icon: ListOrderedIcon,
      pressed: active.orderedList,
      run: () => editor.chain().focus().toggleOrderedList().run(),
    },
    {
      label: 'Blockquote',
      icon: TextQuoteIcon,
      pressed: active.blockquote,
      run: () => editor.chain().focus().toggleBlockquote().run(),
    },
    { label: 'Link', icon: LinkIcon, pressed: active.link, run: editLink },
  ];

  return (
    <div
      role="toolbar"
      aria-label="Formatting"
      className="flex flex-wrap gap-0.5 border-b px-1 py-0.5"
    >
      {buttons.map(({ label, icon: Icon, pressed, run }) => (
        <Button
          key={label}
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={label}
          aria-pressed={pressed}
          disabled={disabled}
          // Keep the editor's selection: the click must not move focus to the button.
          onMouseDown={(event) => {
            event.preventDefault();
          }}
          onClick={run}
        >
          <Icon aria-hidden />
        </Button>
      ))}
    </div>
  );
}
