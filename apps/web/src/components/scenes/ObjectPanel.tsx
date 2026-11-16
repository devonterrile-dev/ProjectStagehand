import type { SceneObject } from '@stagehand/shared';
import { Link } from 'react-router';

import { Button } from '@/components/ui/button';
import { recordPath } from '@/lib/records';

import { PlacementControls, Toggle } from './PlacementControls';

interface ObjectPanelProps {
  campaignId: string;
  /** The scene's objects, in list order. */
  objects: readonly SceneObject[];
  selectedId: string | null;
  /** False while the campaign is archived, or in preview: nothing can be changed. */
  editable: boolean;
  onSelect: (id: string | null) => void;
  onChange: (id: string, change: Partial<SceneObject>) => void;
  onRemove: (id: string) => void;
}

function Controls({
  campaignId,
  object,
  editable,
  onChange,
  onRemove,
}: {
  campaignId: string;
  object: SceneObject;
  editable: boolean;
  onChange: (change: Partial<SceneObject>) => void;
  onRemove: () => void;
}) {
  const isProp = object.kind === 'prop';

  return (
    <section aria-label={`Placing ${object.record.name}`} className="space-y-3">
      <div>
        <h2 className="font-semibold">{object.record.name}</h2>
        <p className="text-xs text-muted-foreground">
          {isProp
            ? 'A prop: players click it to look closer.'
            : 'A puppet: it waits below the scene until you raise it. Place it where it should rise to.'}{' '}
          {/* In a new tab, so the builder stays open behind it. */}
          <Link
            to={recordPath(campaignId, object.record.id)}
            target="_blank"
            rel="noreferrer"
            className="underline"
          >
            Open record
          </Link>
        </p>
        {editable && (
          <p className="text-xs text-muted-foreground">
            Drag it in the theater, or use the arrow keys (Shift for bigger steps). [ and ] step it
            forward and back; Delete removes it.
          </p>
        )}
        {object.image === null && (
          <p role="alert" className="text-xs text-destructive">
            This record has no image for the stage any more, so it isn&apos;t drawn.
          </p>
        )}
      </div>

      <PlacementControls placement={object} disabled={!editable} onChange={onChange}>
        {isProp && (
          <Toggle
            pressed={!object.shown}
            disabled={!editable}
            onChange={(hidden) => {
              onChange({ shown: !hidden });
            }}
          >
            Hidden at first
          </Toggle>
        )}
      </PlacementControls>

      <Button size="xs" variant="destructive" disabled={!editable} onClick={onRemove}>
        Remove from scene
      </Button>
    </section>
  );
}

/**
 * The scene builder's right-hand panel (F3.2, governance §12 "Scene builder" step 3): the
 * selected object's place across, up and in depth, its size and flip, and for a prop whether
 * it is hidden at first and whether it hangs. Below it, everything in the scene, to select
 * without clicking in the theater.
 */
export function ObjectPanel({
  campaignId,
  objects,
  selectedId,
  editable,
  onSelect,
  onChange,
  onRemove,
}: ObjectPanelProps) {
  const selected = objects.find((object) => object.id === selectedId) ?? null;

  return (
    <aside
      aria-label="Scene objects"
      className="flex w-64 shrink-0 flex-col gap-4 overflow-y-auto border-l p-3 text-sm"
    >
      {selected === null ? (
        <p className="text-muted-foreground">
          {objects.length === 0
            ? 'Nothing is placed yet. Add a prop or a puppet from the tray.'
            : 'Select something in the theater, or in the list below, to place it.'}
        </p>
      ) : (
        <Controls
          campaignId={campaignId}
          object={selected}
          editable={editable}
          onChange={(change) => {
            onChange(selected.id, change);
          }}
          onRemove={() => {
            onRemove(selected.id);
          }}
        />
      )}

      {objects.length > 0 && (
        <section aria-label="In this scene" className="space-y-1">
          <h2 className="font-semibold">In this scene</h2>
          <ul>
            {objects.map((object) => (
              <li key={object.id}>
                <button
                  type="button"
                  aria-pressed={object.id === selectedId}
                  className="flex w-full items-baseline justify-between gap-2 rounded-md px-2 py-1 text-left hover:bg-accent aria-pressed:bg-accent"
                  onClick={() => {
                    onSelect(object.id === selectedId ? null : object.id);
                  }}
                >
                  <span className="truncate">{object.record.name}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {object.kind === 'puppet' ? 'puppet' : object.shown ? 'prop' : 'hidden prop'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </aside>
  );
}
