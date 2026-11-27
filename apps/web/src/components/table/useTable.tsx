import {
  loadoutMaxOf,
  rulesetFor,
  type ActionResult,
  type Campaign,
  type CreateEntryRequest,
  type FreeDie,
  type FreeRoll,
  type CardPlace,
  type LiveStage,
  type RollCall,
} from '@stagehand/shared';
import { useCallback, useMemo, useState, type ReactNode } from 'react';

import { AncestryCard, CardPile, SubclassPile } from '@/components/sheets/SideCards';
import { stageImageUrl } from '@/lib/scenes';
import {
  useCreateEntry,
  useCreateNote,
  useEntries,
  useEntry,
  useJournalRecord,
  useJournalRecords,
  useMe,
  useMembers,
  useMoveHeldCard,
  useNotes,
  useOwnCharacterSheet,
  useSetTracks,
} from '@/lib/queries';
import {
  AT_STAGE,
  back,
  cameraView,
  inspect,
  noteSubjectOf,
  openBinder,
  openPage,
  openSheet,
  replacePage,
  startWriting,
  turnTo,
  type TableState,
} from '@/play/table';
import type { TableScene } from '@/stage/PlayCanvas';
import type { SheetSideCards } from '@/stage/RollPieces';

import { BinderBook } from './BinderBook';
import { DiceTray } from './DiceTray';
import { InspectCard, InspectTitle, PAPER_CLASS } from './InspectPapers';
import { SheetPaper } from './SheetPaper';
import { StickyNoteForm } from './StickyNoteForm';

/** A subject no query asks for: what the hooks get while nothing is open. */
const NOTHING = '00000000-0000-4000-8000-000000000000';

/** What the table needs from the live room (F3.6): the stage, and ways to roll. */
export interface TableLive {
  stage: LiveStage | null;
  makeRoll: (callId: string, spendHope: boolean) => Promise<ActionResult>;
  /** The dice tray (F4.2): a free roll, and the last one that landed. */
  freeRoll: (die: FreeDie, count: number, hidden: boolean) => Promise<ActionResult>;
  lastFreeRoll: FreeRoll | null;
}

/** The same value while its contents stay the same, so the scene isn't made anew each stage. */
function useSteady<T>(value: T): T {
  const key = JSON.stringify(value);
  return useMemo(() => JSON.parse(key) as T, [key]);
}

export interface Table {
  state: TableState;
  /** What the theater draws around it. */
  scene: TableScene;
  /** A player pressed a revealed record's cutout. */
  inspect: (recordId: string) => void;
  openBinder: () => void;
  /** Looks down at the sheet page (F3.6); does nothing without one. */
  openSheet: () => void;
  /** The player's own PC, if they have one: whose sheet page is on the table (F3.6). */
  characterId: string | null;
  /** Who is at this browser; null until known. */
  userId: string | null;
  /** One step back: Back, or Escape. */
  back: () => void;
}

/**
 * A browser's place at the table (F3.5b): what it looks at, the journal data that needs, and the
 * HTML pieces laid on the table for it; and (F3.6) the player's sheet page with the roll called
 * for them, the dice of the last roll and the GM's Fear. The HTML is made here, where the queries are, and drawn
 * by the theater: drei `Html` gives its content no React context of its own.
 */
export function useTable(campaign: Campaign, live: TableLive): Table {
  const [state, setState] = useState<TableState>(AT_STAGE);
  const isGm = campaign.role === 'gm';
  const canWrite = campaign.archivedAt === null;
  const ruleset = rulesetFor(campaign.rulesetVersion);

  // The player's own PC and its sheet (F3.6). The GM has none.
  const me = useMe();
  const members = useMembers(campaign.id);
  const characterId = isGm
    ? null
    : (members.data?.find((member) => member.userId === me.data?.id)?.character?.id ?? null);
  const sheet = useOwnCharacterSheet(campaign.id, characterId ?? NOTHING, characterId !== null);
  const moveCard = useMoveHeldCard(campaign.id, characterId ?? NOTHING, 'player').mutateAsync;
  const setTracks = useSetTracks(campaign.id, characterId ?? NOTHING, 'player').mutateAsync;
  const { stage, makeRoll, freeRoll, lastFreeRoll } = live;
  const rest = stage?.rest ?? false;
  const userId = me.data?.id ?? null;
  const call = useSteady<RollCall | null>(
    stage?.calls.find((entry) => entry.characterId === characterId) ?? null,
  );
  const lastRoll = stage?.lastRoll ?? null;
  const diceId = lastRoll?.id ?? null;
  const hopeDie = lastRoll?.dice.hope ?? 0;
  const fearDie = lastRoll?.dice.fear ?? 0;
  const edgeDie = lastRoll?.edgeDie ?? null;
  const fear = stage?.fear ?? 0;
  const spendId = stage?.lastFearSpend?.id ?? null;

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
  const hasSheet = characterId !== null;
  const lookDown = useCallback(() => {
    if (hasSheet) setState(openSheet());
  }, [hasSheet]);
  // Rolling turns the camera back to the theater, to watch the dice land with everyone.
  const rollCall = useCallback(
    async (spendHope: boolean): Promise<string | null> => {
      if (call === null) return 'The GM has taken the roll back';
      const result = await makeRoll(call.id, spendHope);
      if (!result.ok) return result.message;
      setState(AT_STAGE);
      return null;
    },
    [call, makeRoll],
  );

  // The dice tray on the sheet page (F4.2): a player never rolls privately. Rolling turns the
  // camera back to the theater, to watch the dice land with everyone.
  const rollFree = useCallback(
    async (die: FreeDie, count: number): Promise<string | null> => {
      const result = await freeRoll(die, count, false);
      if (!result.ok) return result.message;
      setState(AT_STAGE);
      return null;
    },
    [freeRoll],
  );
  const freeId = lastFreeRoll?.id ?? null;
  const freeDie = lastFreeRoll?.die ?? null;
  const freeResults = useSteady(lastFreeRoll?.results ?? null);

  // The cards beside the sheet page (F4.7): the piles to its left, the subclass and ancestry to
  // its right. Moving a card is the same request as on the site; the sheet comes back with it.
  const sideCards = useMemo((): SheetSideCards | null => {
    const cards = sheet.data?.cards;
    // A PC waiting for the creation guide (F4.8) has no cards to lay out yet.
    if (cards === undefined || sheet.data?.needsGuide === true) return null;
    const actions = canWrite
      ? {
          onMove: (cardId: string, to: CardPlace, swapOut?: string) =>
            moveCard({ cardId, input: { to, ...(swapOut === undefined ? {} : { swapOut }) } }),
        }
      : undefined;
    const pile = (place: CardPlace) => (
      <div className={`${PAPER_CLASS} paper-light h-full w-full rounded-md p-2 font-sans`}>
        <CardPile
          place={place}
          cards={cards[place]}
          loadout={cards.loadout}
          loadoutMax={loadoutMaxOf(ruleset)}
          actions={actions}
          rest={rest}
        />
      </div>
    );
    const card = (node: ReactNode) => <div className="paper-light font-sans">{node}</div>;
    return {
      piles: { loadout: pile('loadout'), vault: pile('vault') },
      subclass:
        cards.subclass === null && cards.multiclass?.subclass == null
          ? null
          : card(<SubclassPile cards={cards} ruleset={ruleset} />),
      ancestry: cards.species.length === 0 ? null : card(<AncestryCard species={cards.species} />),
    };
  }, [sheet.data?.cards, sheet.data?.needsGuide, canWrite, moveCard, ruleset, rest]);

  const scene = useMemo((): TableScene => {
    const imageUrl = (image: Parameters<typeof stageImageUrl>[1]) =>
      stageImageUrl(campaign.id, image);
    const name = record.data?.name ?? entry.data?.title ?? 'this';
    const note =
      (state.at === 'inspect' || state.at === 'binder') && state.writing ? (
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
      sheet: hasSheet
        ? {
            page:
              state.at === 'sheet' ? (
                <SheetPaper
                  sheet={sheet.data}
                  ruleset={ruleset}
                  call={call}
                  onRoll={rollCall}
                  onBack={putDown}
                  tray={<DiceTray onRoll={rollFree} tone="paper" />}
                  onTracks={canWrite ? setTracks : undefined}
                />
              ) : null,
            cards: sideCards,
            waiting: call !== null,
          }
        : null,
      onOpenSheet: lookDown,
      dice: diceId === null ? null : { id: diceId, hope: hopeDie, fear: fearDie, edge: edgeDie },
      freeDice:
        freeId === null || freeDie === null || freeResults === null
          ? null
          : { id: freeId, die: freeDie, results: freeResults },
      fear: { count: fear, spendId },
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
    hasSheet,
    sheet.data,
    sideCards,
    setTracks,
    ruleset,
    call,
    rollCall,
    rollFree,
    lookDown,
    diceId,
    hopeDie,
    fearDie,
    edgeDie,
    freeId,
    freeDie,
    freeResults,
    fear,
    spendId,
  ]);

  return {
    state,
    scene,
    inspect: lookAt,
    openBinder: pickUpBinder,
    openSheet: lookDown,
    characterId,
    userId,
    back: goBack,
  };
}
