import {
  EMOTE_LABELS,
  EMOTES,
  RECORD_TYPE_LABELS,
  rulesetFor,
  STAGE_MAX_OBJECTS,
  type ActionResult,
  type Campaign,
  type FreeRoll,
  type GmStage,
  type GmStageObject,
  type ObjectChanges,
  type Presence,
  type StageImage,
} from '@stagehand/shared';
import { Mic } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';

import { ConfirmDialog } from '@/components/ConfirmDialog';
import { PlacementControls, Toggle } from '@/components/scenes/PlacementControls';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useRecordSearch, useRevealRecord, useScenes, useStageRecords } from '@/lib/queries';
import { recordPath } from '@/lib/records';
import { scenesPath, stageImageUrl } from '@/lib/scenes';
import type { PlayRoom } from '@/play/room';

import { Section } from './DeskSection';
import { EMOTE_ICONS } from './emote-icons';
import { PresenceList } from './PresenceList';
import {
  DiceSection,
  FearSection,
  HopeSection,
  RestSection,
  LogSection,
  RollsSection,
  type RollRoom,
} from './RollDesk';

export type DeskRoom = Pick<
  PlayRoom,
  | 'loadScene'
  | 'setCurtain'
  | 'addObject'
  | 'moveObject'
  | 'removeObject'
  | 'setShown'
  | 'emote'
  | 'takeOverNpc'
  | 'releaseNpc'
> &
  RollRoom;

interface GmDeskProps {
  campaign: Campaign;
  /** The stage as the server last sent it. */
  stage: GmStage;
  /** The GM's moves still on their way, shown in the controls at once. */
  pending: Readonly<Record<string, ObjectChanges>>;
  presence: Presence;
  /** False while the connection is down: nothing can be sent. */
  connected: boolean;
  room: DeskRoom;
  /** The last free roll that landed (F4.2), for the desk's dice tray. */
  lastFreeRoll: FreeRoll | null;
  /** The GM's own user id: their free rolls are the ones the tray plays. */
  userId: string | null;
  /** The object picked here or in the theater; null for none. */
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** Whether the GM's theater leaves hidden props out, as players see it. */
  asPlayers: boolean;
  onAsPlayersChange: (asPlayers: boolean) => void;
  /** Ends the session for everyone. */
  onEnd: () => Promise<unknown>;
}

/** Where an object on the live stage is, in the GM's words. */
function whereabouts(object: GmStageObject): string {
  if (object.image === null) return 'No image';
  if (object.kind === 'puppet') return object.shown ? 'Raised' : 'Waiting below';
  return object.shown ? 'In sight' : 'Hidden';
}

/** An NPC's puppet, raised: one the GM may voice (F3.8). */
function voiceable(object: GmStageObject): boolean {
  return object.kind === 'puppet' && object.subject.kind === 'record' && object.shown;
}

/** The button that brings an object into sight or takes it out. */
function shownAction(object: GmStageObject): string {
  if (object.kind === 'puppet') return object.shown ? 'Lower' : 'Raise';
  return object.shown ? 'Hide' : 'Show';
}

function Thumb({ campaignId, image }: { campaignId: string; image: StageImage }) {
  return (
    <img
      src={stageImageUrl(campaignId, image)}
      alt=""
      loading="lazy"
      className="size-8 shrink-0 object-contain"
    />
  );
}

/** What can be put on the stage live: the PCs, then every Prop, Item and NPC with an image. */
function AddToStage({
  campaign,
  stage,
  disabled,
  onAdd,
}: {
  campaign: Campaign;
  stage: GmStage;
  disabled: boolean;
  onAdd: (subject: { recordId: string } | { characterId: string }) => void;
}) {
  const offer = useStageRecords(campaign.id, true);
  const [search, setSearch] = useState('');
  const needle = search.trim().toLowerCase();
  const matches = (name: string) => name.toLowerCase().includes(needle);
  const full = stage.objects.length >= STAGE_MAX_OBJECTS;
  const onStage = new Set(
    stage.objects
      .filter((object) => object.kind === 'puppet')
      .map((object) => `${object.subject.kind}:${object.subject.id}`),
  );

  const pcs = (offer.data?.characters ?? []).filter((pc) => matches(pc.name));
  const records = (offer.data?.records ?? []).filter((entry) => matches(entry.record.name));

  function row(key: string, name: string, detail: string, image: StageImage, add: () => void) {
    const here = onStage.has(key);
    return (
      <li key={key} className="flex items-center gap-2">
        <Thumb campaignId={campaign.id} image={image} />
        <span className="min-w-0 flex-1">
          <span className="block truncate">{name}</span>
          <span className="block text-xs text-muted-foreground">
            {detail}
            {here ? ' · on stage' : ''}
          </span>
        </span>
        <Button
          size="xs"
          variant="secondary"
          disabled={disabled || here || full}
          aria-label={`Add ${name}`}
          onClick={add}
        >
          Add
        </Button>
      </li>
    );
  }

  return (
    <Section title="Add to stage">
      <p className="text-xs text-muted-foreground">
        It arrives out of sight, hidden or waiting below, so you can place it first. The saved scene
        is not changed.
      </p>
      {full && (
        <p className="text-xs text-muted-foreground">
          The stage is full: it holds {STAGE_MAX_OBJECTS} props and puppets.
        </p>
      )}
      <Input
        type="search"
        aria-label="Search what can be added"
        placeholder="Search…"
        value={search}
        onChange={(event) => {
          setSearch(event.target.value);
        }}
      />
      {offer.isPending && <p className="text-muted-foreground">Loading…</p>}
      {offer.isError && <p role="alert">Could not load what can be added.</p>}
      {offer.data !== undefined && pcs.length + records.length === 0 && (
        <p className="text-muted-foreground">
          {needle === ''
            ? 'Nothing has an image for the stage yet.'
            : 'Nothing matches that search.'}
        </p>
      )}
      <ul aria-label="Can be added" className="max-h-64 space-y-1 overflow-y-auto">
        {pcs.map((pc) =>
          row(`pc:${pc.id}`, pc.name, 'PC · puppet', pc.image, () => {
            onAdd({ characterId: pc.id });
          }),
        )}
        {records.flatMap((entry) =>
          entry.image === null
            ? []
            : [
                row(
                  `record:${entry.record.id}`,
                  entry.record.name,
                  `${RECORD_TYPE_LABELS[entry.record.type]}${entry.kind === 'puppet' ? ' · puppet' : ''}`,
                  entry.image,
                  () => {
                    onAdd({ recordId: entry.record.id });
                  },
                ),
              ],
        )}
      </ul>
    </Section>
  );
}

/** Reveal any record of the campaign, or take one back (§7), found by a search. */
function RevealAny({
  campaign,
  disabled,
  onReveal,
}: {
  campaign: Campaign;
  disabled: boolean;
  onReveal: (recordId: string, revealed: boolean) => void;
}) {
  const [search, setSearch] = useState('');
  const q = search.trim();
  const found = useRecordSearch(campaign.id, { q, limit: 8 }, q !== '');

  return (
    <Section title="Reveal">
      <p className="text-xs text-muted-foreground">
        What comes into sight while the curtain is open is revealed by itself. Reveal anything else
        here.
      </p>
      <Input
        type="search"
        aria-label="Search records to reveal"
        placeholder="Search records…"
        value={search}
        onChange={(event) => {
          setSearch(event.target.value);
        }}
      />
      {q !== '' && found.data?.length === 0 && (
        <p className="text-muted-foreground">Nothing matches that search.</p>
      )}
      {q !== '' && (
        <ul aria-label="Records to reveal" className="space-y-1">
          {found.data?.map((record) => {
            const revealed = record.revealedAt !== null;
            return (
              <li key={record.id} className="flex items-center gap-2">
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{record.name}</span>
                  <span className="block text-xs text-muted-foreground">
                    {RECORD_TYPE_LABELS[record.type]} · {revealed ? 'revealed' : 'hidden'}
                  </span>
                </span>
                <Button
                  size="xs"
                  variant="secondary"
                  disabled={disabled}
                  aria-label={`${revealed ? 'Un-reveal' : 'Reveal'}: ${record.name}`}
                  onClick={() => {
                    onReveal(record.id, !revealed);
                  }}
                >
                  {revealed ? 'Un-reveal' : 'Reveal'}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}

/**
 * The GM's side of a live session (F3.3, F3.4, governance §12 "GM control desk"): the curtain
 * and how the GM's own theater is drawn; the object picked, to place, bring into sight, reveal
 * or take off the stage; everything on the stage; what can be added; revealing any record;
 * the scenes to load; who is here; and ending the session. Every change goes to the server,
 * which sends everyone the stage; moves are shown here at once.
 */
export function GmDesk({
  campaign,
  stage,
  pending,
  presence,
  connected,
  room,
  lastFreeRoll,
  userId,
  selectedId,
  onSelect,
  asPlayers,
  onAsPlayersChange,
  onEnd,
}: GmDeskProps) {
  const scenes = useScenes(campaign.id, true);
  const reveal = useRevealRecord(campaign.id);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [ending, setEnding] = useState(false);
  const [removing, setRemoving] = useState<GmStageObject | null>(null);

  /** Sends one action; the stage itself comes back from the server, for everyone at once. */
  async function send(action: () => Promise<ActionResult>) {
    setBusy(true);
    setRefusal(null);
    const result = await action();
    setBusy(false);
    if (!result.ok) setRefusal(result.message);
  }

  /** A move: no waiting, so a slider or a drag keeps going; a refusal is still said. */
  function move(id: string, changes: ObjectChanges) {
    void room.moveObject(id, changes).then((result) => {
      if (!result.ok) setRefusal(result.message);
    });
  }

  function setRevealed(recordId: string, revealed: boolean) {
    setRefusal(null);
    reveal.mutate(
      { recordId, revealed },
      {
        onError: (error) => {
          setRefusal(error.message);
        },
      },
    );
  }

  const idle = connected && !busy;
  const ruleset = rulesetFor(campaign.rulesetVersion);
  const rolls = { stage, ruleset, room, idle, send };
  const archived = campaign.archivedAt !== null;
  const stageObject = stage.objects.find((object) => object.id === selectedId) ?? null;
  const selected = stageObject === null ? null : { ...stageObject, ...pending[stageObject.id] };
  // The NPC whose voice is the GM's (F3.8); the server gives it back if it leaves the stage.
  const voicingId = presence.find((person) => person.role === 'gm')?.voicing ?? null;
  const voiced = stage.objects.find((object) => object.id === voicingId) ?? null;
  const npcName = (objectId: string) =>
    stage.objects.find((object) => object.id === objectId)?.subject.name;

  /** Takes over an NPC's voice, or gives it back when it is already the one voiced. */
  function voice(object: GmStageObject) {
    void send(() => (object.id === voicingId ? room.releaseNpc() : room.takeOverNpc(object.id)));
  }

  return (
    <aside
      aria-label="Control desk"
      className={`relative flex shrink-0 flex-col overflow-y-auto border-l text-sm ${selected === null ? 'w-72' : 'w-80'}`}
    >
      <header className="space-y-1 border-b px-3 py-3">
        <Link to={`/campaigns/${campaign.id}`} className="underline">
          ← {campaign.name}
        </Link>
        <h1 className="text-base font-semibold">Session {stage.session.number}</h1>
      </header>

      {refusal !== null && (
        <p role="alert" className="border-b px-3 py-2 text-destructive">
          {refusal}
        </p>
      )}

      {voiced !== null && (
        <section
          aria-label="Voicing"
          className="flex items-center gap-2 border-b bg-amber-100/60 px-3 py-2 dark:bg-amber-900/30"
        >
          <Mic aria-hidden="true" className="size-4 shrink-0" />
          <p className="min-w-0 flex-1">
            Voicing <strong>{voiced.subject.name}</strong>: your voice moves this puppet.
          </p>
          <Button
            size="xs"
            variant="secondary"
            disabled={!idle}
            onClick={() => void send(() => room.releaseNpc())}
          >
            Release
          </Button>
        </section>
      )}

      <Section title="Curtain">
        <Button
          size="sm"
          className="w-full"
          disabled={!idle}
          onClick={() => void send(() => room.setCurtain(!stage.curtainOpen))}
        >
          {stage.curtainOpen ? 'Close the curtain' : 'Open the curtain'}
        </Button>
        <p className="text-xs text-muted-foreground">
          {stage.curtainOpen
            ? 'Loading a scene now closes the curtain, changes the scene and opens it again.'
            : 'Loading a scene now keeps the curtain closed, so you can set the stage first.'}
        </p>
        <Toggle pressed={asPlayers} disabled={false} onChange={onAsPlayersChange}>
          As players see it
        </Toggle>
      </Section>

      <RollsSection {...rolls} />
      <FearSection {...rolls} />
      <HopeSection {...rolls} />
      <RestSection {...rolls} />
      <DiceSection room={room} userId={userId} lastFreeRoll={lastFreeRoll} />

      {selected !== null && stageObject !== null && (
        <section
          aria-label={`Selected: ${selected.subject.name}`}
          className="space-y-3 border-b px-3 py-3"
        >
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <h2 className="truncate font-semibold">{selected.subject.name}</h2>
              <p className="text-xs text-muted-foreground">
                {selected.subject.kind === 'pc' ? 'PC' : RECORD_TYPE_LABELS[selected.subject.type]}{' '}
                · {whereabouts(stageObject)}
                {selected.subject.kind === 'record' &&
                  (selected.subject.revealed ? ' · revealed' : ' · not revealed')}
              </p>
            </div>
            <Button
              size="xs"
              variant="ghost"
              onClick={() => {
                onSelect(null);
              }}
            >
              Let go
            </Button>
          </div>

          <div className="flex flex-wrap gap-1.5">
            <Button
              size="xs"
              disabled={!idle}
              onClick={() => void send(() => room.setShown(stageObject, !stageObject.shown))}
            >
              {shownAction(stageObject)}
            </Button>
            {selected.subject.kind === 'record' && (
              <Button
                size="xs"
                variant="secondary"
                disabled={!connected || archived || reveal.isPending}
                onClick={() => {
                  if (selected.subject.kind === 'record') {
                    setRevealed(selected.subject.id, !selected.subject.revealed);
                  }
                }}
              >
                {selected.subject.revealed ? 'Un-reveal' : 'Reveal'}
              </Button>
            )}
            {voiceable(stageObject) && (
              // NPC takeover (F3.8): while on, the GM's talking moves this puppet.
              <Button
                size="xs"
                variant="secondary"
                aria-pressed={stageObject.id === voicingId}
                disabled={!idle}
                onClick={() => {
                  voice(stageObject);
                }}
              >
                <Mic aria-hidden="true" />
                {stageObject.id === voicingId ? 'Stop voicing' : 'Voice this NPC'}
              </Button>
            )}
            {selected.subject.kind === 'record' && (
              // In a new tab: leaving this page would take the GM out of the session.
              <Link
                to={recordPath(campaign.id, selected.subject.id)}
                target="_blank"
                rel="noreferrer"
                className="self-center text-xs underline"
              >
                Open record
              </Link>
            )}
          </div>

          {stageObject.kind === 'puppet' && stageObject.shown && (
            // Emotes (F3.7): played once, for everyone, on a raised puppet.
            <div role="group" aria-label="Emote" className="space-y-1">
              <h3 className="text-xs font-medium text-muted-foreground uppercase">Emote</h3>
              <div className="grid grid-cols-2 gap-1">
                {EMOTES.map((emote) => {
                  const Icon = EMOTE_ICONS[emote];
                  return (
                    <Button
                      key={emote}
                      size="xs"
                      variant="secondary"
                      className="justify-start"
                      disabled={!idle}
                      onClick={() => void send(() => room.emote(stageObject.id, emote))}
                    >
                      <Icon aria-hidden="true" />
                      {EMOTE_LABELS[emote]}
                    </Button>
                  );
                })}
              </div>
            </div>
          )}

          <p className="text-xs text-muted-foreground">
            Drag it in the theater, or use the arrow keys (Shift for bigger steps). [ and ] step it
            forward and back.
          </p>
          <PlacementControls
            placement={selected}
            disabled={!connected}
            onChange={({ mount, ...change }) => {
              // A puppet has no mount to change; a prop's is a stand or a string.
              move(selected.id, mount == null ? change : { ...change, mount });
            }}
          />

          <Button
            size="xs"
            variant="destructive"
            disabled={!idle}
            onClick={() => {
              setRemoving(stageObject);
            }}
          >
            Remove from stage
          </Button>
        </section>
      )}

      <Section title="On stage">
        {stage.objects.length === 0 ? (
          <p className="text-muted-foreground">
            {stage.sceneLoad === 0 ? 'Nothing yet. Load a scene to begin.' : 'An empty theater.'}
          </p>
        ) : (
          <ul aria-label="On stage" className="space-y-0.5">
            {stage.objects.map((object) => (
              <li key={object.id} className="flex items-center gap-1">
                <button
                  type="button"
                  aria-pressed={object.id === selectedId}
                  className="flex min-w-0 flex-1 items-baseline gap-2 rounded-md px-2 py-1 text-left hover:bg-accent aria-pressed:bg-accent"
                  onClick={() => {
                    onSelect(object.id === selectedId ? null : object.id);
                  }}
                >
                  <span className="min-w-0 flex-1 truncate">{object.subject.name}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {whereabouts(object)}
                    {object.subject.kind === 'record' && object.subject.revealed
                      ? ' · revealed'
                      : ''}
                  </span>
                </button>
                {voiceable(object) && (
                  // One click to voice another NPC (F3.8).
                  <Button
                    size="xs"
                    variant={object.id === voicingId ? 'default' : 'ghost'}
                    aria-label={`Voice: ${object.subject.name}`}
                    aria-pressed={object.id === voicingId}
                    disabled={!idle}
                    onClick={() => {
                      voice(object);
                    }}
                  >
                    <Mic aria-hidden="true" />
                  </Button>
                )}
                <Button
                  size="xs"
                  variant="secondary"
                  disabled={!idle || object.image === null}
                  aria-label={`${shownAction(object)}: ${object.subject.name}`}
                  onClick={() => void send(() => room.setShown(object, !object.shown))}
                >
                  {shownAction(object)}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <AddToStage
        campaign={campaign}
        stage={stage}
        disabled={!idle}
        onAdd={(subject) => {
          const id = crypto.randomUUID();
          void send(async () => {
            const result = await room.addObject({ id, ...subject });
            if (result.ok) onSelect(id);
            return result;
          });
        }}
      />

      <RevealAny
        campaign={campaign}
        disabled={!connected || archived || reveal.isPending}
        onReveal={setRevealed}
      />

      <Section title="Scenes">
        {scenes.isPending && <p className="text-muted-foreground">Loading…</p>}
        {scenes.isError && <p role="alert">Could not load the scenes.</p>}
        {scenes.data?.length === 0 && (
          <p className="text-muted-foreground">
            No scenes yet.{' '}
            {/* In a new tab: leaving this page would take the GM out of the session. */}
            <Link
              to={scenesPath(campaign.id)}
              target="_blank"
              rel="noreferrer"
              className="underline"
            >
              Build one
            </Link>
            , then load it here.
          </p>
        )}
        <ul aria-label="Scenes" className="space-y-1.5">
          {scenes.data?.map((scene) => {
            const onStage = stage.scene?.id === scene.id;
            return (
              <li key={scene.id} className="flex items-center gap-2">
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{scene.name}</span>
                  {onStage && <span className="block text-xs text-muted-foreground">On stage</span>}
                </span>
                <Button
                  size="xs"
                  variant="secondary"
                  disabled={!idle}
                  aria-label={`${onStage ? 'Load again' : 'Load'}: ${scene.name}`}
                  onClick={() => {
                    onSelect(null);
                    void send(() => room.loadScene(scene.id));
                  }}
                >
                  {onStage ? 'Load again' : 'Load'}
                </Button>
              </li>
            );
          })}
        </ul>
      </Section>

      <Section title="Who is here">
        <PresenceList presence={presence} npcName={npcName} />
      </Section>

      <LogSection campaignId={campaign.id} />

      <div className="mt-auto px-3 py-3">
        <Button
          size="sm"
          variant="destructive"
          className="w-full"
          onClick={() => {
            setEnding(true);
          }}
        >
          End session
        </Button>
      </div>

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) setRemoving(null);
        }}
        title={`Take ${removing?.subject.name ?? 'it'} off the stage?`}
        description="It leaves the stage for everyone. The saved scene keeps it, so loading the scene again brings it back."
        confirmLabel="Remove from stage"
        onConfirm={async () => {
          if (removing === null) return;
          const { id } = removing;
          onSelect(null);
          await send(() => room.removeObject(id));
        }}
      />

      <ConfirmDialog
        open={ending}
        onOpenChange={setEnding}
        title="End the session?"
        description="The theater closes for everyone. You can start a new session whenever you like."
        confirmLabel="End session"
        onConfirm={onEnd}
      />
    </aside>
  );
}
