import { useId } from 'react';

import type { MentionMenuState } from '@/lib/record-mentions';

import { RecordOptionList } from './RecordOptionList';

interface MentionMenuProps {
  state: MentionMenuState;
  active: number;
  onActivate: (index: number) => void;
}

/**
 * The @ menu under a mention being typed: the matching records, picked with the arrow keys
 * and Enter (handled by the editor) or the mouse. Nothing shows when nothing matches.
 */
export function MentionMenu({ state, active, onActivate }: MentionMenuProps) {
  const id = useId();
  if (state.items.length === 0) return null;
  const rect = state.rect;
  return (
    <RecordOptionList
      id={id}
      label="Mention a record"
      options={state.items}
      active={active}
      onPick={state.pick}
      onActivate={onActivate}
      className="mention-menu fixed w-64"
      style={rect === null ? undefined : { top: rect.bottom + 4, left: rect.left }}
    />
  );
}
