import {
  createEntryRequestSchema,
  ENTRY_DESCRIPTION_MAX,
  ENTRY_TITLE_MAX,
  RECORD_TYPE_LABELS,
  RECORD_TYPES,
  type CreateEntryRequest,
  type JournalRecord,
  type JournalRecordSummary,
  type PlayerEntry,
  type PlayerNote,
  type RecordType,
  type StageImage,
} from '@stagehand/shared';
import { useState, type ReactNode } from 'react';

import { RichTextView } from '@/components/records/RichTextView';
import { postedTime } from '@/lib/journal';
import { pluralLabel } from '@/lib/records';
import { pageKey, type BinderPage } from '@/play/table';

import { PAPER_CLASS } from './InspectPapers';

/** Sticky notes shown on a record's or entry's page at once. */
export const NOTES_PER_PAGE = 3;

export interface BinderBookProps {
  page: BinderPage;
  /** Undefined while loading. */
  records: readonly JournalRecordSummary[] | undefined;
  entries: readonly PlayerEntry[] | undefined;
  /** The open record or entry; null when it is gone or no longer revealed. */
  record: JournalRecord | null | undefined;
  entry: PlayerEntry | null | undefined;
  notes: readonly PlayerNote[] | null | undefined;
  imageUrl: (image: StageImage) => string;
  /** Notes may be written (the campaign isn't archived). */
  canWrite: boolean;
  /** Entries may be written: a player, in a campaign that isn't archived. */
  canMakeEntries: boolean;
  onTurnTo: (page: BinderPage) => void;
  onBack: () => void;
  onClose: () => void;
  onPostNote: () => void;
  /** Writes a new entry; rejects with the server's refusal. */
  onCreateEntry: (entry: CreateEntryRequest) => Promise<unknown>;
}

/**
 * The three-ring binder's open page at the table (F3.5b, governance §12): the journal. The key
 * lists Player entries first, then each record type with something revealed; a type lists its
 * records; a record or entry shows itself on the top half and its three newest notes on sticky
 * notes below, with arrows for older ones. Back goes one page back. Plain DOM with no React
 * context: it is drawn inside the 3D scene (drei `Html`).
 */
export function BinderBook(props: BinderBookProps) {
  const { page, onBack, onClose } = props;
  return (
    <div
      className={`${PAPER_CLASS} relative flex h-full w-full flex-col overflow-hidden rounded-r-md`}
    >
      {/* The page's punched holes, down its left edge. */}
      <div aria-hidden className="absolute top-0 bottom-0 left-3 flex flex-col justify-around">
        {[0, 1, 2].map((hole) => (
          <span key={hole} className="size-4 rounded-full bg-stone-700/70" />
        ))}
      </div>
      <nav className="flex items-center justify-between pt-3 pr-4 pl-10 text-base">
        <button
          type="button"
          className="rounded px-2 py-0.5 underline-offset-4 hover:underline"
          onClick={onBack}
        >
          ‹ Back
        </button>
        <button
          type="button"
          aria-label="Close the binder"
          className="rounded px-2 py-0.5 underline-offset-4 hover:underline"
          onClick={onClose}
        >
          ✕
        </button>
      </nav>
      <div key={pageKey(page)} className="binder-turn flex min-h-0 flex-1 flex-col pr-6 pb-4 pl-10">
        <PageBody {...props} />
      </div>
    </div>
  );
}

function PageBody(props: BinderBookProps) {
  const { page } = props;
  switch (page.kind) {
    case 'key':
      return <KeyPage {...props} />;
    case 'records':
      return <RecordsPage {...props} type={page.type} />;
    case 'entries':
      return <EntriesPage {...props} />;
    case 'record':
      return <RecordPage {...props} />;
    case 'entry':
      return <EntryPage {...props} />;
    case 'new-entry':
      return <NewEntryPage {...props} />;
  }
}

function Heading({ children }: { children: ReactNode }) {
  return <h2 className="mb-3 border-b border-stone-400 pb-1 text-3xl font-semibold">{children}</h2>;
}

function Loading() {
  return <p className="text-lg text-stone-600">Turning the page…</p>;
}

/** A line in a list on the page, pressed to turn to what it names. */
function Line({ children, onPress }: { children: ReactNode; onPress: () => void }) {
  return (
    <li>
      <button
        type="button"
        className="w-full rounded px-1 py-1 text-left text-xl hover:bg-stone-900/5 hover:underline"
        onClick={onPress}
      >
        {children}
      </button>
    </li>
  );
}

function KeyPage({ records, entries, onTurnTo }: BinderBookProps) {
  const counts = new Map<RecordType, number>();
  for (const record of records ?? []) counts.set(record.type, (counts.get(record.type) ?? 0) + 1);
  return (
    <>
      <Heading>Journal</Heading>
      <ul aria-label="Journal sections" className="space-y-1">
        <Line
          onPress={() => {
            onTurnTo({ kind: 'entries' });
          }}
        >
          Player entries{entries === undefined ? '' : ` (${String(entries.length)})`}
        </Line>
        {RECORD_TYPES.filter((type) => (counts.get(type) ?? 0) > 0).map((type) => (
          <Line
            key={type}
            onPress={() => {
              onTurnTo({ kind: 'records', type });
            }}
          >
            {pluralLabel(type)} ({counts.get(type)})
          </Line>
        ))}
      </ul>
      {records?.length === 0 && (
        <p className="mt-4 text-lg text-stone-600">Nothing has been revealed yet.</p>
      )}
    </>
  );
}

function RecordsPage({ records, onTurnTo, type }: BinderBookProps & { type: RecordType }) {
  const shown = (records ?? []).filter((record) => record.type === type);
  return (
    <>
      <Heading>{pluralLabel(type)}</Heading>
      {records === undefined ? (
        <Loading />
      ) : shown.length === 0 ? (
        <p className="text-lg text-stone-600">None revealed any more.</p>
      ) : (
        <ul aria-label={pluralLabel(type)} className="min-h-0 flex-1 space-y-1 overflow-y-auto">
          {shown.map((record) => (
            <Line
              key={record.id}
              onPress={() => {
                onTurnTo({ kind: 'record', recordId: record.id });
              }}
            >
              {record.name}
              {record.parentName !== null && (
                <span className="text-base text-stone-600"> · {record.parentName}</span>
              )}
            </Line>
          ))}
        </ul>
      )}
    </>
  );
}

function EntriesPage({ entries, canMakeEntries, onTurnTo }: BinderBookProps) {
  return (
    <>
      <Heading>Player entries</Heading>
      {canMakeEntries && (
        <button
          type="button"
          className="mb-3 self-start rounded border border-stone-500 px-3 py-1 text-lg hover:bg-stone-900/5"
          onClick={() => {
            onTurnTo({ kind: 'new-entry' });
          }}
        >
          + New entry
        </button>
      )}
      {entries === undefined ? (
        <Loading />
      ) : entries.length === 0 ? (
        <p className="text-lg text-stone-600">No player entries yet.</p>
      ) : (
        <ul aria-label="Player entries" className="min-h-0 flex-1 space-y-1 overflow-y-auto">
          {entries.map((entry) => (
            <Line
              key={entry.id}
              onPress={() => {
                onTurnTo({ kind: 'entry', entryId: entry.id });
              }}
            >
              {entry.title}
              <span className="text-base text-stone-600"> · {entry.author.displayName}</span>
            </Line>
          ))}
        </ul>
      )}
    </>
  );
}

function Gone({ what }: { what: string }) {
  return (
    <p className="text-lg text-stone-600">
      This {what} is no longer in the journal. Go back a page.
    </p>
  );
}

function RecordPage(props: BinderBookProps) {
  const { record, imageUrl, onTurnTo } = props;
  if (record === undefined) return <Loading />;
  if (record === null) return <Gone what="record" />;
  return (
    <>
      <div className="flex min-h-0 basis-1/2 gap-4 overflow-hidden">
        {record.image !== null && (
          <img
            src={imageUrl(record.image)}
            alt=""
            className="h-full max-h-56 w-auto max-w-[40%] shrink-0 object-contain"
          />
        )}
        <div className="flex min-h-0 flex-1 flex-col">
          <h2 className="text-3xl font-semibold">{record.name}</h2>
          <p className="mb-2 text-base text-stone-600">{RECORD_TYPE_LABELS[record.type]}</p>
          <div className="min-h-0 flex-1 overflow-y-auto text-lg leading-relaxed">
            <RichTextView
              value={record.publicDescription}
              onMention={(recordId) => {
                onTurnTo({ kind: 'record', recordId });
              }}
            />
          </div>
        </div>
      </div>
      <NotesStrip {...props} />
    </>
  );
}

function EntryPage(props: BinderBookProps) {
  const { entry } = props;
  if (entry === undefined) return <Loading />;
  if (entry === null) return <Gone what="entry" />;
  return (
    <>
      <div className="flex min-h-0 basis-1/2 flex-col overflow-hidden">
        <h2 className="text-3xl font-semibold">{entry.title}</h2>
        <p className="mb-2 text-base text-stone-600">
          {entry.author.displayName} · {postedTime(entry.createdAt)}
        </p>
        <p className="min-h-0 flex-1 overflow-y-auto text-lg leading-relaxed whitespace-pre-wrap">
          {entry.description}
        </p>
      </div>
      <NotesStrip {...props} />
    </>
  );
}

/**
 * The bottom half of a record's or entry's page: its three newest notes on sticky notes, left to
 * right, and arrows in the corner for the next three older (or newer) ones.
 */
export function NotesStrip({ notes, canWrite, onPostNote }: BinderBookProps) {
  const [first, setFirst] = useState(0);
  const all = notes ?? [];
  const shown = all.slice(first, first + NOTES_PER_PAGE);
  const newer = first > 0;
  const older = first + NOTES_PER_PAGE < all.length;

  return (
    <section aria-label="Notes" className="mt-3 flex min-h-0 basis-1/2 flex-col">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-xl font-semibold">Notes</h3>
        {canWrite && (
          <button
            type="button"
            className="rounded bg-yellow-200 px-3 py-0.5 text-base shadow hover:bg-yellow-300"
            onClick={onPostNote}
          >
            Post note
          </button>
        )}
      </div>
      {notes === undefined ? (
        <Loading />
      ) : all.length === 0 ? (
        <p className="text-lg text-stone-600">No notes yet.</p>
      ) : (
        <ul aria-label="Sticky notes" className="grid min-h-0 flex-1 grid-cols-3 gap-3">
          {shown.map((note, index) => (
            <li
              key={note.id}
              className="flex min-h-0 flex-col rounded-sm bg-yellow-200 p-2 shadow"
              style={{ rotate: `${String((index - 1) * 1.5)}deg` }}
            >
              <p className="min-h-0 flex-1 overflow-hidden text-base leading-snug break-words whitespace-pre-wrap">
                {note.body}
              </p>
              <p className="mt-1 truncate text-right text-xs text-stone-700">
                {note.author.displayName} · {postedTime(note.createdAt)}
              </p>
            </li>
          ))}
        </ul>
      )}
      {(newer || older) && (
        <div className="mt-2 flex justify-end gap-2 text-lg">
          <button
            type="button"
            aria-label="Newer notes"
            className="rounded px-2 disabled:opacity-30"
            disabled={!newer}
            onClick={() => {
              setFirst(Math.max(0, first - NOTES_PER_PAGE));
            }}
          >
            ‹
          </button>
          <button
            type="button"
            aria-label="Older notes"
            className="rounded px-2 disabled:opacity-30"
            disabled={!older}
            onClick={() => {
              setFirst(first + NOTES_PER_PAGE);
            }}
          >
            ›
          </button>
        </div>
      )}
    </section>
  );
}

function NewEntryPage({ onCreateEntry }: BinderBookProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="flex min-h-0 flex-1 flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        const parsed = createEntryRequestSchema.safeParse({ title, description });
        if (!parsed.success) {
          setError(parsed.error.issues[0]?.message ?? 'Check the entry');
          return;
        }
        setSaving(true);
        setError(null);
        onCreateEntry(parsed.data).catch((refused: unknown) => {
          setSaving(false);
          setError(refused instanceof Error ? refused.message : 'Could not save the entry');
        });
      }}
    >
      <Heading>New entry</Heading>
      <label className="flex flex-col gap-1 text-base">
        Title
        <input
          className="border-b border-stone-500 bg-transparent text-2xl outline-none"
          value={title}
          maxLength={ENTRY_TITLE_MAX}
          autoFocus
          onChange={(event) => {
            setTitle(event.target.value);
          }}
        />
      </label>
      <label className="flex min-h-0 flex-1 flex-col gap-1 text-base">
        Description
        <textarea
          className="min-h-0 flex-1 resize-none bg-[repeating-linear-gradient(transparent,transparent_1.95rem,#c8bfa8_2rem)] text-xl leading-8 outline-none"
          value={description}
          maxLength={ENTRY_DESCRIPTION_MAX}
          onChange={(event) => {
            setDescription(event.target.value);
          }}
        />
      </label>
      {error !== null && (
        <p role="alert" className="text-base text-red-800">
          {error}
        </p>
      )}
      <button
        type="submit"
        className="self-end rounded bg-stone-800 px-4 py-1 text-lg text-[#f4efe2] disabled:opacity-40"
        disabled={saving || title.trim() === ''}
      >
        Save
      </button>
    </form>
  );
}
