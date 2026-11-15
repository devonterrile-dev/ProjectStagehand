import { DEPTH_TICKS, SCENE_SCALE, type SceneObject } from '@stagehand/shared';
import { useId, type ReactNode } from 'react';
import { Link } from 'react-router';

import { Button } from '@/components/ui/button';
import { recordPath } from '@/lib/records';

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

const percent = (value: number) => `${String(Math.round(value * 100))}%`;

/** A labelled slider with its value beside it. */
function Slider({
  label,
  value,
  min,
  max,
  step,
  shown,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  /** The value as the GM reads it. */
  shown: string;
  disabled: boolean;
  onChange: (value: number) => void;
}) {
  const id = useId();
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id}>{label}</label>
        <span className="text-xs text-muted-foreground tabular-nums">{shown}</span>
      </div>
      <input
        id={id}
        type="range"
        className="w-full"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(event) => {
          onChange(Number(event.target.value));
        }}
      />
    </div>
  );
}

/** An on-or-off button. */
function Toggle({
  pressed,
  disabled,
  onChange,
  children,
}: {
  pressed: boolean;
  disabled: boolean;
  onChange: (pressed: boolean) => void;
  children: ReactNode;
}) {
  return (
    <Button
      size="xs"
      variant={pressed ? 'default' : 'secondary'}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={() => {
        onChange(!pressed);
      }}
    >
      {children}
    </Button>
  );
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
  const lastTick = DEPTH_TICKS - 1;

  return (
    <section aria-label={`Placing ${object.record.name}`} className="space-y-3">
      <div>
        <h2 className="font-semibold">{object.record.name}</h2>
        <p className="text-xs text-muted-foreground">
          {isProp
            ? 'A prop: players click it to look closer.'
            : 'A puppet: it waits below the scene until you raise it. Place it where it should rise to.'}{' '}
          <Link to={recordPath(campaignId, object.record.id)} className="underline">
            Open record
          </Link>
        </p>
        {object.image === null && (
          <p role="alert" className="text-xs text-destructive">
            This record has no image for the stage any more, so it isn&apos;t drawn.
          </p>
        )}
      </div>

      <Slider
        label="Left to right"
        value={object.across}
        min={0}
        max={1}
        step={0.01}
        shown={percent(object.across)}
        disabled={!editable}
        onChange={(across) => {
          onChange({ across });
        }}
      />
      <Slider
        label="Height"
        value={object.up}
        min={0}
        max={1}
        step={0.01}
        shown={percent(object.up)}
        disabled={!editable}
        onChange={(up) => {
          onChange({ up });
        }}
      />

      <div role="group" aria-label="Depth" className="space-y-1">
        <div className="flex items-baseline justify-between gap-2">
          <span>Depth</span>
          <span className="text-xs text-muted-foreground tabular-nums">
            tick {object.depthTick} of 0 (front) to {lastTick} (back)
          </span>
        </div>
        <div className="flex gap-1.5">
          <Button
            size="xs"
            variant="secondary"
            disabled={!editable || object.depthTick <= 0}
            onClick={() => {
              onChange({ depthTick: object.depthTick - 1 });
            }}
          >
            Step forward
          </Button>
          <Button
            size="xs"
            variant="secondary"
            disabled={!editable || object.depthTick >= lastTick}
            onClick={() => {
              onChange({ depthTick: object.depthTick + 1 });
            }}
          >
            Step back
          </Button>
        </div>
      </div>

      <Slider
        label="Size"
        value={object.scale}
        min={SCENE_SCALE.min}
        max={SCENE_SCALE.max}
        step={0.05}
        shown={percent(object.scale)}
        disabled={!editable}
        onChange={(scale) => {
          onChange({ scale });
        }}
      />

      <div className="flex flex-wrap gap-1.5">
        <Toggle
          pressed={object.flipped}
          disabled={!editable}
          onChange={(flipped) => {
            onChange({ flipped });
          }}
        >
          Flipped
        </Toggle>
        {isProp && (
          <>
            <Toggle
              pressed={!object.shown}
              disabled={!editable}
              onChange={(hidden) => {
                onChange({ shown: !hidden });
              }}
            >
              Hidden at first
            </Toggle>
            <Toggle
              pressed={object.mount === 'hang'}
              disabled={!editable}
              onChange={(hangs) => {
                onChange({ mount: hangs ? 'hang' : 'stand' });
              }}
            >
              Hangs from the roof
            </Toggle>
          </>
        )}
      </div>

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
