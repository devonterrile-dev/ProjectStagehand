import type { RichText, RichTextBlock, RichTextInline } from '@stagehand/shared';
import type { ReactNode } from 'react';
import { Link } from 'react-router';

/**
 * Read-only rich text, rendered straight from the stored document (D-22) as plain
 * elements: no editor, no toolbar, no `innerHTML`. The document already passed
 * `richTextSchema`, so only its closed set of nodes and marks can appear, and link hrefs
 * are limited to http(s) and mailto.
 */
export function RichTextView({
  value,
  className,
  mentionHref,
  onMention,
}: {
  value: RichText;
  className?: string;
  /**
   * Where a mention leads (the player journal, F3.5, where the server has already turned
   * mentions of records players don't have into plain text). Without it, mentions are text.
   */
  mentionHref?: (recordId: string) => string;
  /**
   * Called when a mention is pressed, for a view with no router (the binder at the table,
   * F3.5b). Like `mentionHref`, for text whose hidden mentions the server already made plain.
   */
  onMention?: (recordId: string) => void;
}) {
  const mention: Mention =
    mentionHref !== undefined
      ? (id, label) => (
          <Link to={mentionHref(id)} className="underline">
            {label}
          </Link>
        )
      : onMention !== undefined
        ? (id, label) => (
            <button
              type="button"
              className="underline"
              onClick={() => {
                onMention(id);
              }}
            >
              {label}
            </button>
          )
        : undefined;
  return (
    <div className={`rich-text-view space-y-2 ${className ?? ''}`}>
      {blocks(value.content, mention)}
    </div>
  );
}

/** How a mention is drawn; without one, it is its label as plain text. */
type Mention = ((recordId: string, label: string) => ReactNode) | undefined;

function blocks(content: readonly RichTextBlock[], href: Mention): ReactNode[] {
  return content.map((block, index) => {
    switch (block.type) {
      case 'paragraph':
        return <p key={index}>{inline(block.content ?? [], href)}</p>;
      case 'heading': {
        const Tag = `h${String(block.attrs.level + 2)}` as 'h3' | 'h4' | 'h5';
        return (
          <Tag key={index} className="font-semibold">
            {inline(block.content ?? [], href)}
          </Tag>
        );
      }
      case 'bulletList':
        return (
          <ul key={index} className="list-disc space-y-1 pl-6">
            {block.content.map((item, i) => (
              <li key={i}>{blocks(item.content, href)}</li>
            ))}
          </ul>
        );
      case 'orderedList':
        return (
          <ol key={index} start={block.attrs?.start} className="list-decimal space-y-1 pl-6">
            {block.content.map((item, i) => (
              <li key={i}>{blocks(item.content, href)}</li>
            ))}
          </ol>
        );
      case 'blockquote':
        return (
          <blockquote key={index} className="border-l-2 pl-3 text-muted-foreground">
            {blocks(block.content, href)}
          </blockquote>
        );
      case 'horizontalRule':
        return <hr key={index} />;
    }
  });
}

function inline(content: readonly RichTextInline[], href: Mention): ReactNode[] {
  return content.map((node, index) => {
    if (node.type === 'hardBreak') return <br key={index} />;
    // A mention is plain text here unless the caller says where it leads: this view is what
    // players see, and a mention must not lead them to a record they haven't been shown (D-24).
    let element: ReactNode =
      node.type !== 'mention'
        ? node.text
        : href === undefined
          ? node.attrs.label
          : href(node.attrs.id, node.attrs.label);
    for (const mark of node.marks ?? []) {
      switch (mark.type) {
        case 'bold':
          element = <strong>{element}</strong>;
          break;
        case 'italic':
          element = <em>{element}</em>;
          break;
        case 'strike':
          element = <s>{element}</s>;
          break;
        case 'code':
          element = <code>{element}</code>;
          break;
        case 'link':
          element = (
            <a
              href={mark.attrs.href}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="underline"
            >
              {element}
            </a>
          );
          break;
      }
    }
    return <span key={index}>{element}</span>;
  });
}
