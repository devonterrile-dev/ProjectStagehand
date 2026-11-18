import {
  DEPTH_TICKS,
  rulesetFor,
  type Campaign,
  type Emote,
  type ObjectChanges,
} from '@stagehand/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { useStore } from 'zustand';

import { FullscreenButton } from '@/components/play/FullscreenButton';
import { GmDesk } from '@/components/play/GmDesk';
import { PresenceList } from '@/components/play/PresenceList';
import { VoiceControl } from '@/components/play/VoiceControl';
import { EmoteCard } from '@/components/table/EmoteCard';
import { TableNotices } from '@/components/table/TableNotices';
import { useTable } from '@/components/table/useTable';
import { Button } from '@/components/ui/button';
import {
  characterSheetKey,
  journalKey,
  sessionLogKey,
  useCampaign,
  useEndPlaySession,
  useStartPlaySession,
} from '@/lib/queries';
import { keyAction, type KeyPlacement } from '@/lib/scenes';
import { createPlayRoom } from '@/play/room';
import { useVoice } from '@/play/voice';
import { EMPTY_THEATER, talkingPuppets, theaterView } from '@/play/stage';
import { PlayCanvas, type OwnPuppet } from '@/stage/PlayCanvas';
import type { Place } from '@/stage/placement';

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** A key's move kept inside the opening and on a real depth tick, as the server requires. */
function insideStage(change: Partial<KeyPlacement>): ObjectChanges {
  return {
    ...(change.across === undefined ? {} : { across: clamp(change.across, 0, 1) }),
    ...(change.up === undefined ? {} : { up: clamp(change.up, 0, 1) }),
    ...(change.depthTick === undefined
      ? {}
      : { depthTick: clamp(change.depthTick, 0, DEPTH_TICKS - 1) }),
  };
}

/** A message in place of the theater: loading, waiting, not allowed. */
function Notice({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3 p-6 text-center">
      {children}
    </div>
  );
}

/**
 * `/campaigns/:campaignId/play`: the table during a live session (F3.3, F3.4, governance §13).
 * The theater fills the window, like every stage page, and is loaded lazily so Three.js stays
 * out of the main bundle. Players see the theater and the table in front of it (F3.5b): a
 * revealed record's cutout is pressed to inspect it, and the binder holds the journal. The GM has
 * the control desk beside the theater, picks and drags what is on stage in it, and has the binder
 * too. Rolls (F3.6): a player rolls from their sheet page, looked down at with the Sheet button,
 * a scroll down or the down arrow; everyone sees the dice land and the GM's Fear in its bowl.
 * Everyone can put the page in fullscreen, where the browser allows it.
 */
export function PlayPage() {
  const { campaignId = '' } = useParams();
  const campaignQuery = useCampaign(campaignId);

  if (campaignQuery.isPending) return <Notice>Loading…</Notice>;
  if (campaignQuery.isError) {
    return (
      <Notice>
        <p role="alert">Could not load this campaign. Try again in a moment.</p>
      </Notice>
    );
  }
  const campaign = campaignQuery.data;
  if (campaign === null) {
    return (
      <Notice>
        <h1 className="text-2xl font-bold">Campaign not found</h1>
        <p>It may not exist, or you may not be a member of it.</p>
        <Link to="/" className="underline">
          Back to your campaigns
        </Link>
      </Notice>
    );
  }
  // A new room for another campaign: nothing of one table carries over to the next.
  return <Table key={campaign.id} campaign={campaign} />;
}

function Table({ campaign }: { campaign: Campaign }) {
  const [room] = useState(() => createPlayRoom(campaign.id));
  useEffect(() => {
    room.open();
    return () => {
      room.close();
    };
  }, [room]);

  const {
    phase,
    connected,
    stage,
    view,
    presence,
    pending,
    journal,
    sheet,
    sheetChanged,
    log,
    emotes,
  } = useStore(room.store);

  // Talking (F3.7, F3.9): the mic in a tab or Discord in the Activity, and holding T.
  const setSpeaking = useCallback(
    (speaking: boolean) => {
      room.setSpeaking(speaking);
    },
    [room],
  );
  const voice = useVoice(setSpeaking);
  const makeRoll = useCallback(
    (callId: string, spendHope: boolean) => room.makeRoll(callId, spendHope),
    [room],
  );
  const table = useTable(campaign, { stage, makeRoll });
  const atStage = table.state.at === 'stage';
  const { back: tableBack, openSheet, characterId } = table;
  const ruleset = rulesetFor(campaign.rulesetVersion);

  // The journal may have changed (a reveal, a note, an entry): read it again.
  const queryClient = useQueryClient();
  useEffect(() => {
    if (journal === 0) return;
    void queryClient.invalidateQueries({ queryKey: journalKey(campaign.id) });
  }, [journal, queryClient, campaign.id]);

  // The player's sheet changed (a roll, the GM's correction or edit): read it again (F3.6).
  useEffect(() => {
    if (sheet === 0 || characterId === null) return;
    if (sheetChanged !== null && sheetChanged !== characterId) return;
    void queryClient.invalidateQueries({ queryKey: characterSheetKey(campaign.id, characterId) });
  }, [sheet, sheetChanged, characterId, queryClient, campaign.id]);

  // The session's log grew: the GM's desk reads it again (F3.6).
  useEffect(() => {
    if (log === 0) return;
    void queryClient.invalidateQueries({ queryKey: sessionLogKey(campaign.id) });
  }, [log, queryClient, campaign.id]);

  // A player looks down at their sheet with the down arrow, from the theater (F3.6).
  useEffect(() => {
    if (!atStage || characterId === null) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'ArrowDown' || event.defaultPrevented) return;
      const { target } = event;
      if (
        target instanceof Element &&
        target.closest('input, select, textarea, [contenteditable], [role="dialog"]') !== null
      ) {
        return;
      }
      event.preventDefault();
      openSheet();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [atStage, characterId, openSheet]);

  // Escape steps back from the table toward the theater, wherever focus is.
  useEffect(() => {
    if (atStage) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      const { target } = event;
      if (target instanceof Element && target.closest('[role="dialog"], [role="alertdialog"]')) {
        return;
      }
      event.preventDefault();
      tableBack();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [atStage, tableBack]);
  // The desk can be put away: in a small window or Activity frame the theater needs the room.
  const [deskOpen, setDeskOpen] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [asPlayers, setAsPlayers] = useState(false);
  const start = useStartPlaySession(campaign.id);
  const end = useEndPlaySession(campaign.id);

  const isGm = campaign.role === 'gm';
  const archived = campaign.archivedAt !== null;
  const theater = useMemo(
    () =>
      view === null
        ? EMPTY_THEATER
        : theaterView(campaign.id, view.stage, { hiddenProps: !asPlayers, pending }),
    [campaign.id, view, asPlayers, pending],
  );

  // Puppet motion (F3.7): who is talking and the emotes played, in either theater.
  const motion = useMemo(
    () => ({ talking: talkingPuppets(theater.cutouts, presence), emotes }),
    [theater.cutouts, presence, emotes],
  );

  // A player's emote card, open beside their own puppet (F3.7); only ever on the stage view.
  const [emoteFor, setEmoteFor] = useState<string | null>(null);
  if (emoteFor !== null && !atStage) setEmoteFor(null);
  const ownName =
    presence.find((person) => person.characterId !== null && person.characterId === characterId)
      ?.characterName ?? null;
  const own = useMemo((): OwnPuppet | undefined => {
    if (isGm || characterId === null) return undefined;
    const close = () => {
      setEmoteFor(null);
    };
    return {
      characterId,
      onPress: (objectId) => {
        setEmoteFor((open) => (open === objectId ? null : objectId));
      },
      onClose: close,
      menu:
        emoteFor === null
          ? null
          : {
              objectId: emoteFor,
              card: (
                <EmoteCard
                  name={ownName}
                  onEmote={(emote: Emote) => {
                    close();
                    void room.emote(emoteFor, emote);
                  }}
                  onClose={close}
                />
              ),
            },
    };
  }, [isGm, characterId, emoteFor, ownName, room]);

  // Escape closes the emote card.
  useEffect(() => {
    if (emoteFor === null) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      setEmoteFor(null);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [emoteFor]);

  // What the GM picked, while it is still on the stage.
  const gmStage = stage?.role === 'gm' ? stage : null;
  const selected = gmStage?.objects.find((object) => object.id === selectedId) ?? null;
  const picked = selected === null ? null : selected.id;

  const onMove = useCallback(
    (id: string, place: Place) => {
      void room.moveObject(id, place);
    },
    [room],
  );

  // The builder's keys for the object the GM picked: arrows across and up, [ and ] in depth,
  // Escape to let go. Not while typing, in a dialog or in a menu.
  useEffect(() => {
    // Not while the GM is reading the binder: its keys are its own.
    if (selected === null || !atStage) return;
    const { id } = selected;
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
      const { target } = event;
      if (
        target instanceof Element &&
        target.closest(
          'input, select, textarea, [contenteditable], [role="dialog"], [role="alertdialog"], [role="menu"]',
        ) !== null
      ) {
        return;
      }
      const placed = { ...selected, ...room.store.getState().pending[id] };
      const action = keyAction(placed, event.key, event.shiftKey);
      if (action === null || action === 'remove') return;
      event.preventDefault();
      if (action === 'deselect') {
        setSelectedId(null);
        return;
      }
      void room.moveObject(id, insideStage(action.change));
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [room, selected, atStage]);

  const back = (
    <Link to={`/campaigns/${campaign.id}`} className="underline">
      Back to {campaign.name}
    </Link>
  );
  // The server tells the room when the session starts, and the room joins by itself.
  const startButton = isGm && !archived && (
    <>
      <Button
        disabled={start.isPending}
        onClick={() => {
          start.mutate();
        }}
      >
        Start session
      </Button>
      {start.isError && (
        <p role="alert" className="text-sm text-red-400">
          {start.error.message}
        </p>
      )}
    </>
  );

  if (phase === 'signed-out') {
    return (
      <Notice>
        <p>You&apos;ve been signed out. Sign in again to come back to the table.</p>
        <Link to="/" className="underline">
          Sign in
        </Link>
      </Notice>
    );
  }
  if (phase === 'not-found') {
    return (
      <Notice>
        <p>You&apos;re not a member of this campaign any more.</p>
        <Link to="/" className="underline">
          Back to your campaigns
        </Link>
      </Notice>
    );
  }
  if (phase === 'waiting') {
    return (
      <Notice>
        <h1 className="text-2xl font-bold">{campaign.name}</h1>
        {isGm ? (
          <p>No session is running.</p>
        ) : (
          <p>
            Waiting for your GM to start the session. The theater opens here by itself when it
            starts.
          </p>
        )}
        {startButton}
        {back}
      </Notice>
    );
  }
  if (phase === 'ended') {
    return (
      <Notice>
        <h1 className="text-2xl font-bold">The session has ended</h1>
        {!isGm && <p>If your GM starts another, the theater opens here again.</p>}
        {startButton}
        {back}
      </Notice>
    );
  }
  if (phase === 'full') {
    return (
      <Notice>
        <h1 className="text-2xl font-bold">The session is full</h1>
        <p>It already has its 6 players. When one of them leaves, you can take the seat.</p>
        <Button
          disabled={!connected}
          onClick={() => {
            room.join();
          }}
        >
          Try again
        </Button>
        {back}
      </Notice>
    );
  }
  if (phase === 'connecting' || stage === null) {
    return (
      <Notice>
        <p>Connecting to the table…</p>
        {back}
      </Notice>
    );
  }

  return (
    <div className="dark flex h-full w-full bg-background text-foreground">
      <div
        className="relative min-w-0 flex-1 bg-black"
        // A scroll down on the theater looks down at the sheet page (F3.6).
        onWheel={(event) => {
          if (atStage && event.deltaY > 0) openSheet();
        }}
      >
        <PlayCanvas
          backdropUrl={theater.backdropUrl}
          objects={theater.cutouts}
          curtainOpen={view?.curtainOpen ?? false}
          {...(isGm
            ? { selectedId: picked, onSelect: setSelectedId, onMove }
            : { onInspect: table.inspect })}
          table={table.scene}
          motion={motion}
          {...(own === undefined ? {} : { own })}
        />
        <TableNotices
          stage={stage}
          ruleset={ruleset}
          characterId={characterId}
          atSheet={table.state.at === 'sheet'}
          onGoToSheet={openSheet}
        />
        {!connected && (
          <p
            role="status"
            className="absolute top-3 left-1/2 z-20 -translate-x-1/2 rounded-md bg-black/80 px-3 py-2 text-sm text-white"
          >
            Connection lost. Reconnecting…
          </p>
        )}
        {!isGm && (
          <div className="absolute top-3 left-3 z-20 max-w-56 space-y-2 rounded-md bg-black/60 px-3 py-2 text-sm text-white">
            {/* In a narrow window the list would cover the theater: only the way out stays. */}
            <div className="hidden w-50 sm:block">
              <PresenceList presence={presence} />
            </div>
            <div className="flex flex-wrap gap-2">
              <TableButton
                atStage={atStage}
                onOpen={table.openBinder}
                onBack={tableBack}
                {...(characterId === null ? {} : { onSheet: openSheet })}
              />
              <FullscreenButton />
            </div>
            <VoiceControl voice={voice} />
            <Link to={`/campaigns/${campaign.id}`} className="block text-xs underline">
              Leave the table
            </Link>
          </div>
        )}
        {isGm && (
          <div className="absolute top-3 left-3 z-20 space-y-2 rounded-md bg-black/60 px-3 py-2 text-sm text-white">
            <div className="flex flex-wrap gap-2">
              <TableButton atStage={atStage} onOpen={table.openBinder} onBack={tableBack} />
              <FullscreenButton />
            </div>
            <VoiceControl voice={voice} />
          </div>
        )}
        {isGm && (
          <Button
            size="xs"
            variant="secondary"
            className="absolute top-3 right-3 z-20"
            aria-expanded={deskOpen}
            onClick={() => {
              setDeskOpen((open) => !open);
            }}
          >
            {deskOpen ? 'Hide desk' : 'Show desk'}
          </Button>
        )}
      </div>
      {stage.role === 'gm' && deskOpen && (
        <GmDesk
          campaign={campaign}
          stage={stage}
          pending={pending}
          presence={presence}
          connected={connected}
          room={room}
          selectedId={picked}
          onSelect={setSelectedId}
          asPlayers={asPlayers}
          onAsPlayersChange={setAsPlayers}
          onEnd={() => end.mutateAsync()}
        />
      )}
    </div>
  );
}

/**
 * The way to the binder from the theater, and back again, without finding it on the table: in a
 * small window the table's strip is thin (F3.5b). A player with a PC also has their sheet (F3.6).
 */
function TableButton({
  atStage,
  onOpen,
  onBack,
  onSheet,
}: {
  atStage: boolean;
  onOpen: () => void;
  onBack: () => void;
  onSheet?: () => void;
}) {
  if (!atStage) {
    return (
      <Button size="xs" variant="secondary" onClick={onBack}>
        Back
      </Button>
    );
  }
  return (
    <div className="flex gap-2">
      <Button size="xs" variant="secondary" onClick={onOpen}>
        Journal
      </Button>
      {onSheet !== undefined && (
        <Button size="xs" variant="secondary" onClick={onSheet}>
          Sheet
        </Button>
      )}
    </div>
  );
}
