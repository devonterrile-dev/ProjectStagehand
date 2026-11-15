import type { ActionResult, Campaign, GmStage, GmStageObject, Presence } from '@stagehand/shared';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';

import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { useScenes } from '@/lib/queries';
import { scenesPath } from '@/lib/scenes';
import type { PlayRoom } from '@/play/room';

import { PresenceList } from './PresenceList';

interface GmDeskProps {
  campaign: Campaign;
  /** The stage as the server last sent it. */
  stage: GmStage;
  presence: Presence;
  /** False while the connection is down: nothing can be sent. */
  connected: boolean;
  room: Pick<PlayRoom, 'loadScene' | 'setCurtain'>;
  /** Ends the session for everyone. */
  onEnd: () => Promise<unknown>;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2 border-b px-3 py-3">
      <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        {title}
      </h2>
      {children}
    </section>
  );
}

/** Where an object on the live stage is, in the GM's words. */
function whereabouts(object: GmStageObject): string {
  if (object.image === null) return 'No image';
  if (object.kind === 'puppet') return object.shown ? 'Raised' : 'Waiting below';
  return object.shown ? 'In sight' : 'Hidden';
}

/**
 * The GM's side of a live session (F3.3): load a scene, open and close the curtain, see who is
 * here and what the stage holds, and end the session. Raising, moving, showing and revealing
 * come with the full control desk (F3.4, governance §12 "GM control desk").
 */
export function GmDesk({ campaign, stage, presence, connected, room, onEnd }: GmDeskProps) {
  const scenes = useScenes(campaign.id, true);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [ending, setEnding] = useState(false);

  /** Sends one action; the stage itself comes back from the server, for everyone at once. */
  async function send(action: () => Promise<ActionResult>) {
    setBusy(true);
    setRefusal(null);
    const result = await action();
    setBusy(false);
    if (!result.ok) setRefusal(result.message);
  }

  const idle = connected && !busy;

  return (
    <aside
      aria-label="Control desk"
      className="flex w-72 shrink-0 flex-col overflow-y-auto border-l text-sm"
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

      <Section title="Curtain">
        <Button
          size="sm"
          className="w-full"
          disabled={!idle}
          onClick={() => void send(() => room.setCurtain(!stage.curtainOpen))}
        >
          {stage.curtainOpen ? 'Close the curtain' : 'Open the curtain'}
        </Button>
      </Section>

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
                  onClick={() => void send(() => room.loadScene(scene.id))}
                >
                  {onStage ? 'Load again' : 'Load'}
                </Button>
              </li>
            );
          })}
        </ul>
      </Section>

      <Section title="On stage">
        {stage.objects.length === 0 ? (
          <p className="text-muted-foreground">
            {stage.sceneLoad === 0 ? 'Nothing yet. Load a scene to begin.' : 'An empty theater.'}
          </p>
        ) : (
          <ul aria-label="On stage" className="space-y-1">
            {stage.objects.map((object) => (
              <li key={object.id} className="flex items-baseline gap-2">
                <span className="min-w-0 flex-1 truncate">{object.record.name}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {whereabouts(object)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Who is here">
        <PresenceList presence={presence} />
      </Section>

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
