/**
 * @-mentions in a record's text (F1.5b, D-24). The record form provides the campaign's
 * records through `RecordMentionsContext`; a `RichTextEditor` inside it can then mention
 * them, and shows each mention as a chip. Editors outside it (sheets, stat blocks) can't.
 */
import type { RecordSummary } from '@stagehand/shared';
import { ReactNodeViewRenderer } from '@tiptap/react';
import type { SuggestionProps } from '@tiptap/suggestion';
import { createContext } from 'react';

import { mentionNode } from './rich-text-extensions';
import { filterRecords } from './records';

export interface RecordMentions {
  campaignId: string;
  /** The record being edited, which isn't offered. */
  selfId: string;
  records: readonly RecordSummary[];
  byId: ReadonlyMap<string, RecordSummary>;
}

export const RecordMentionsContext = createContext<RecordMentions | null>(null);

/** How many records the @ menu shows at once. */
export const MENTION_MATCHES = 8;

/** What the editor's @ menu shows while a mention is being typed. */
export interface MentionMenuState {
  items: RecordSummary[];
  /** Where the typed `@query` is on screen, to place the menu under it. */
  rect: DOMRect | null;
  pick: (record: RecordSummary) => void;
}

/** The editor's side of the suggestion: React state for the menu, and its keys. */
export interface MentionMenuBridge {
  show: (state: MentionMenuState) => void;
  hide: () => void;
  /** True when the menu used the key (arrows, Enter, Esc). */
  keyDown: (event: KeyboardEvent) => boolean;
}

/**
 * The mention node with its chip view and the @ suggestion. `mentions` is read on every
 * keystroke, so it always sees the latest records.
 */
export function recordMentionExtension(
  mentions: () => RecordMentions | null,
  bridge: MentionMenuBridge,
  Chip: Parameters<typeof ReactNodeViewRenderer>[0],
) {
  const stateOf = (props: SuggestionProps<RecordSummary>): MentionMenuState => ({
    items: props.items,
    rect: props.clientRect?.() ?? null,
    pick: (record) => {
      props.command({ id: record.id, label: record.name });
    },
  });

  return mentionNode
    .extend({
      addNodeView() {
        return ReactNodeViewRenderer(Chip);
      },
    })
    .configure({
      suggestion: {
        char: '@',
        items: ({ query }) => {
          const current = mentions();
          if (current === null) return [];
          return filterRecords(current.records, query, {
            exclude: [current.selfId],
            limit: MENTION_MATCHES,
          });
        },
        render: () => ({
          onStart: (props: SuggestionProps<RecordSummary>) => {
            bridge.show(stateOf(props));
          },
          onUpdate: (props: SuggestionProps<RecordSummary>) => {
            bridge.show(stateOf(props));
          },
          onExit: () => {
            bridge.hide();
          },
          onKeyDown: ({ event }: { event: KeyboardEvent }) => bridge.keyDown(event),
        }),
      },
    });
}
