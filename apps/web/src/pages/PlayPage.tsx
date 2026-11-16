import { DEPTH_TICKS, type Campaign, type ObjectChanges } from '@stagehand/shared';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { useStore } from 'zustand';

import { GmDesk } from '@/components/play/GmDesk';
import { PresenceList } from '@/components/play/PresenceList';
import { Button } from '@/components/ui/button';
import { useCampaign, useEndPlaySession, useStartPlaySession } from '@/lib/queries';
import { keyAction, type KeyPlacement } from '@/lib/scenes';
import { createPlayRoom } from '@/play/room';
import { EMPTY_THEATER, theaterView } from '@/play/stage';
import { PlayCanvas } from '@/stage/PlayCanvas';
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
 * out of the main bundle. Players see only the theater; the GM has the control desk beside it,
 * and can pick and drag what is on stage in the theater itself.
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

  const { phase, connected, stage, view, presence, pending } = useStore(room.store);
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
    if (selected === null) return;
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
  }, [room, selected]);

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
      <div className="relative min-w-0 flex-1 bg-black">
        <PlayCanvas
          backdropUrl={theater.backdropUrl}
          objects={theater.cutouts}
          curtainOpen={view?.curtainOpen ?? false}
          {...(isGm ? { selectedId: picked, onSelect: setSelectedId, onMove } : {})}
        />
        {!connected && (
          <p
            role="status"
            className="absolute top-3 left-1/2 -translate-x-1/2 rounded-md bg-black/80 px-3 py-2 text-sm text-white"
          >
            Connection lost. Reconnecting…
          </p>
        )}
        {!isGm && (
          <div className="absolute top-3 left-3 max-w-56 space-y-2 rounded-md bg-black/60 px-3 py-2 text-sm text-white">
            {/* In a narrow window the list would cover the theater: only the way out stays. */}
            <div className="hidden w-50 sm:block">
              <PresenceList presence={presence} />
            </div>
            <Link to={`/campaigns/${campaign.id}`} className="block text-xs underline">
              Leave the table
            </Link>
          </div>
        )}
        {isGm && (
          <Button
            size="xs"
            variant="secondary"
            className="absolute top-3 right-3"
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
