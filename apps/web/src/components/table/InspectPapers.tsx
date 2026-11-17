import type { JournalRecord } from '@stagehand/shared';

import { RichTextView } from '@/components/records/RichTextView';

/** Paper on the table: warm off-white, ink, a soft shadow. */
export const PAPER_CLASS = 'bg-[#f4efe2] text-stone-900 font-serif shadow-lg';

/**
 * The paper sign above the inspect stage (F3.5b): the record's name. Plain DOM with no React
 * context: it is drawn inside the 3D scene (drei `Html`).
 */
export function InspectTitle({ name }: { name: string | null }) {
  return (
    <div className={`${PAPER_CLASS} rounded-sm px-6 py-3 text-center`}>
      <h2 className="truncate text-3xl font-semibold">{name ?? '…'}</h2>
    </div>
  );
}

interface InspectCardProps {
  /** Undefined while it loads. */
  record: JournalRecord | undefined;
  canWrite: boolean;
  onPostNote: () => void;
  onClose: () => void;
}

/**
 * The paper card in front of the inspect stage (F3.5b): what the player can see, the record's
 * public description, with Post note and a close mark.
 */
export function InspectCard({ record, canWrite, onPostNote, onClose }: InspectCardProps) {
  return (
    <section
      aria-label="Inspecting"
      className={`${PAPER_CLASS} flex h-full w-full flex-col gap-3 rounded-sm px-7 pt-5 pb-4`}
    >
      <div className="min-h-0 flex-1 overflow-y-auto text-xl leading-relaxed">
        {record === undefined ? (
          <p className="text-stone-600">Looking closer…</p>
        ) : (
          <RichTextView value={record.publicDescription} />
        )}
      </div>
      <div className="flex items-center justify-between text-lg">
        <button
          type="button"
          className="rounded px-2 py-1 underline-offset-4 hover:underline"
          aria-label="Stop inspecting"
          onClick={onClose}
        >
          ✕ Close
        </button>
        {canWrite && (
          <button
            type="button"
            className="rounded bg-yellow-200 px-4 py-1 shadow hover:bg-yellow-300"
            disabled={record === undefined}
            onClick={onPostNote}
          >
            Post note
          </button>
        )}
      </div>
    </section>
  );
}
