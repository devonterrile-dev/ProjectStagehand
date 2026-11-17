import { EMOTE_LABELS, EMOTES, type Emote } from '@stagehand/shared';

import { EMOTE_ICONS } from '@/components/play/emote-icons';

import { PAPER_CLASS } from './InspectPapers';

interface EmoteCardProps {
  /** The PC whose puppet it is. */
  name: string | null;
  onEmote: (emote: Emote) => void;
  onClose: () => void;
}

/**
 * The paper card beside a player's own puppet (F3.7, governance §12 "Player emotes"): the ten
 * emotes, two to a row. Plain DOM with no React context: it is drawn inside the 3D scene (drei
 * `Html`).
 */
export function EmoteCard({ name, onEmote, onClose }: EmoteCardProps) {
  return (
    <section
      aria-label={name === null ? 'Emotes' : `Emotes for ${name}`}
      className={`${PAPER_CLASS} w-64 rounded-sm px-3 pt-2 pb-3`}
    >
      <div className="mb-1 flex items-center justify-between">
        <h2 className="truncate text-sm font-semibold">{name ?? 'Your puppet'}</h2>
        <button
          type="button"
          aria-label="Close emotes"
          className="rounded px-1.5 text-sm hover:bg-stone-900/10"
          onClick={onClose}
        >
          ✕
        </button>
      </div>
      <ul className="grid grid-cols-2 gap-1">
        {EMOTES.map((emote) => {
          const Icon = EMOTE_ICONS[emote];
          return (
            <li key={emote}>
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm hover:bg-stone-900/10 focus-visible:bg-stone-900/10"
                onClick={() => {
                  onEmote(emote);
                }}
              >
                <Icon aria-hidden="true" className="size-4 shrink-0" />
                {EMOTE_LABELS[emote]}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
