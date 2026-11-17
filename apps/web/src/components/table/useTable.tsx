import type { Campaign, CreateEntryRequest } from '@stagehand/shared';
import { useCallback, useMemo, useState } from 'react';

import { stageImageUrl } from '@/lib/scenes';
import {
  useCreateEntry,
  useCreateNote,
  useEntries,
  useEntry,
  useJournalRecord,
  useJournalRecords,
  useNotes,
} from '@/lib/queries';
import {
  AT_STAGE,
  back,
  cameraView,
  inspect,
  noteSubjectOf,
  openBinder,
  openPage,
  replacePage,
  startWriting,
  turnTo,
  type TableState,
} from '@/play/table';
import type { TableScene } from '@/stage/PlayCanvas';

import { BinderBook } from './BinderBook';
import { InspectCard, InspectTitle } from './InspectPapers';
import { StickyNoteForm } from './StickyNoteForm';

/** A subject no query asks for: what the hooks get while nothing is open. */
const NOTHING = '00000000-0000-4000-8000-000000000000';

export interface Table {
  state: TableState;
  /** What the theater draws around it. */
  scene: TableScene;
  /** A player pressed a revealed record's cutout. */
  inspect: (recordId: string) => void;
  openBinder: () => void;
  /** One step back: Back, or Escape. */
  back: () => void;
}

/**
 * A browser's place at the table (F3.5b): what it looks at, the journal data that needs, and the
 * HTML pieces laid on the table for it. The HTML is made here, where the queries are, and drawn
 * by the theater: drei `Html` gives its content no React context of its own.
 */
export function useTable(campaign: Campaign): Table {
  const [state, setState] = useState<TableState>(AT_STAGE);
  const isGm = campaign.role === 'gm';
  const canWrite = campaign.archivedAt === null;

  const page = openPage(state);
  const open = noteSubjectOf(state);
  const recordId = open !== null && 'recordId' in open ? open.recordId : null;
  const entryId = open !== null && 'entryId' in open ? open.entryId : null;
  // The same object while the same thing is open, so the scene below isn't made anew.
  const subject = useMemo(
    () => (recordId !== null ? { recordId } : entryId !== null ? { entryId } : null),
    [recordId, entryId],
  );
  const binderOpen = state.at === 'binder';

  const records = useJournalRecords(campaign.id, {}, binderOpen);
  const entries = useEntries(campaign.id, binderOpen);
  const record = useJournalRecord(campaign.id, recordId ?? NOTHING, recordId !== null);
  const entry = useEntry(campaign.id, entryId ?? NOTHING, entryId !== null);
  const notes = useNotes(campaign.id, subject ?? { recordId: NOTHING }, subject !== null);
  const createNote = useCreateNote(campaign.id, subject ?? { recordId: NOTHING });
  const createEntry = useCreateEntry(campaign.id);

  // A record that leaves the journal while it is on the inspect stage is put away (worked out
  // while rendering: the documented way to follow what a query answers).
  if (state.at === 'inspect' && record.data === null) setState(AT_STAGE);

  const postNote = createNote.mutateAsync;
  const makeEntry = createEntry.mutateAsync;
  const goBack = useCallback(() => {
    setState(back);
  }, []);
  const putDown = useCallback(() => {
    setState(AT_STAGE);
  }, []);
  const pickUpBinder = useCallback(() => {
    setState(openBinder());
  }, []);
  const lookAt = useCallback((id: string) => {
    setState(inspect(id));
  }, []);

  const scene = useMemo((): TableScene => {
    const imageUrl = (image: Parameters<typeof stageImageUrl>[1]) =>
      stageImageUrl(campaign.id, image);
    const name = record.data?.name ?? entry.data?.title ?? 'this';
    const note =
      state.at !== 'stage' && state.writing ? (
        <StickyNoteForm
          key={JSON.stringify(subject)}
          about={name}
          onPost={postNote}
          onBack={goBack}
        />
      ) : null;
    const inspected = state.at === 'inspect' ? (record.data ?? undefined) : undefined;

    return {
      view: cameraView(state),
      inspect:
        state.at === 'inspect'
          ? {
              image:
                inspected?.image === undefined || inspected.image === null
                  ? null
                  : {
                      url: imageUrl(inspected.image),
                      width: inspected.image.width,
                      height: inspected.image.height,
                    },
              title: <InspectTitle name={inspected?.name ?? null} />,
              card: (
                <InspectCard
                  record={inspected}
                  canWrite={canWrite}
                  onPostNote={() => {
                    setState(startWriting);
                  }}
                  onClose={putDown}
                />
              ),
            }
          : null,
      inspectNote: state.at === 'inspect' ? note : null,
      binderPage:
        page === null ? null : (
          <BinderBook
            page={page}
            records={records.data}
            entries={entries.data}
            record={page.kind === 'record' ? record.data : undefined}
            entry={page.kind === 'entry' ? entry.data : undefined}
            notes={notes.data}
            imageUrl={imageUrl}
            canWrite={canWrite}
            canMakeEntries={canWrite && !isGm}
            onTurnTo={(next) => {
              setState((current) => turnTo(current, next));
            }}
            onBack={goBack}
            onClose={putDown}
            onPostNote={() => {
              setState(startWriting);
            }}
            onCreateEntry={async (input: CreateEntryRequest) => {
              const made = await makeEntry(input);
              setState((current) => replacePage(current, { kind: 'entry', entryId: made.id }));
            }}
          />
        ),
      binderNote: state.at === 'binder' ? note : null,
      onOpenBinder: pickUpBinder,
      onPutDown: putDown,
    };
  }, [
    state,
    page,
    subject,
    campaign.id,
    canWrite,
    isGm,
    record.data,
    entry.data,
    records.data,
    entries.data,
    notes.data,
    postNote,
    makeEntry,
    goBack,
    putDown,
    pickUpBinder,
  ]);

  return { state, scene, inspect: lookAt, openBinder: pickUpBinder, back: goBack };
}
