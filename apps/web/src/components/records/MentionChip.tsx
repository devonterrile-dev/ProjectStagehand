import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import { useContext } from 'react';

import { RecordMentionsContext } from '@/lib/record-mentions';

import { RecordOpenMenu } from './RecordOpenMenu';

/**
 * An @-mention inside the record editor (F1.5b). A mention of a record that still exists
 * shows its current name and opens the Open / Open in new tab menu; one whose record was
 * deleted shows the name it was saved with, as plain text (D-24).
 */
export function MentionChip({ node }: NodeViewProps) {
  const mentions = useContext(RecordMentionsContext);
  const id = String(node.attrs['id'] ?? '');
  const savedLabel = String(node.attrs['label'] ?? '');
  const record = mentions?.byId.get(id);

  if (record === undefined) {
    return (
      <NodeViewWrapper as="span" className="mention mention-stale" title="This record was deleted">
        @{savedLabel}
      </NodeViewWrapper>
    );
  }
  return (
    <NodeViewWrapper as="span" className="mention">
      <RecordOpenMenu recordId={record.id} name={record.name}>
        <button type="button" className="mention-button">
          @{record.name}
        </button>
      </RecordOpenMenu>
    </NodeViewWrapper>
  );
}
