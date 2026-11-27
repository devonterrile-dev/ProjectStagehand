import { DEPTH_TICKS, SCENE_SCALE, type PropMount } from '@stagehand/shared';
import { useId, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';

const percent = (value: number) => `${String(Math.round(value * 100))}%`;

/** A labelled slider with its value beside it. */
export function Slider({
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
export function Toggle({
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

/** Where an object is and how it is drawn: what both the builder and the desk can change. */
export interface Placement {
  across: number;
  up: number;
  depthTick: number;
  scale: number;
  flipped: boolean;
  /** A prop's stand or string; null for a puppet, which is on a stick. */
  mount: PropMount | null;
}

/**
 * The controls for an object's place (governance §12 "Placing things in the scene"): across
 * and up the opening, a step forward or back between depth ticks, its size, a flip, and for a
 * prop whether it hangs from the roof. The scene builder (F3.2) and the control desk (F3.4)
 * both use them; `children` adds what is the caller's own.
 */
export function PlacementControls({
  placement,
  disabled,
  acrossLocked = false,
  onChange,
  children,
}: {
  placement: Placement;
  disabled: boolean;
  /**
   * A passer in a transition scene (F5.4): its place across follows the travel, so it can't be
   * set here; everything else can.
   */
  acrossLocked?: boolean;
  onChange: (change: Partial<Placement>) => void;
  /** More toggles, beside Flipped. */
  children?: ReactNode;
}) {
  const lastTick = DEPTH_TICKS - 1;
  return (
    <>
      <Slider
        label="Left to right"
        value={placement.across}
        min={0}
        max={1}
        step={0.01}
        shown={acrossLocked ? 'Passing by' : percent(placement.across)}
        disabled={disabled || acrossLocked}
        onChange={(across) => {
          onChange({ across });
        }}
      />
      <Slider
        label="Height"
        value={placement.up}
        min={0}
        max={1}
        step={0.01}
        shown={percent(placement.up)}
        disabled={disabled}
        onChange={(up) => {
          onChange({ up });
        }}
      />

      <div role="group" aria-label="Depth" className="space-y-1">
        <div className="flex items-baseline justify-between gap-2">
          <span>Depth</span>
          <span className="text-xs text-muted-foreground tabular-nums">
            tick {placement.depthTick} of 0 (front) to {lastTick} (back)
          </span>
        </div>
        <div className="flex gap-1.5">
          <Button
            size="xs"
            variant="secondary"
            disabled={disabled || placement.depthTick <= 0}
            onClick={() => {
              onChange({ depthTick: placement.depthTick - 1 });
            }}
          >
            Step forward
          </Button>
          <Button
            size="xs"
            variant="secondary"
            disabled={disabled || placement.depthTick >= lastTick}
            onClick={() => {
              onChange({ depthTick: placement.depthTick + 1 });
            }}
          >
            Step back
          </Button>
        </div>
      </div>

      <Slider
        label="Size"
        value={placement.scale}
        min={SCENE_SCALE.min}
        max={SCENE_SCALE.max}
        step={0.05}
        shown={percent(placement.scale)}
        disabled={disabled}
        onChange={(scale) => {
          onChange({ scale });
        }}
      />

      <div className="flex flex-wrap gap-1.5">
        <Toggle
          pressed={placement.flipped}
          disabled={disabled}
          onChange={(flipped) => {
            onChange({ flipped });
          }}
        >
          Flipped
        </Toggle>
        {children}
        {placement.mount !== null && (
          <Toggle
            pressed={placement.mount === 'hang'}
            disabled={disabled}
            onChange={(hangs) => {
              onChange({ mount: hangs ? 'hang' : 'stand' });
            }}
          >
            Hangs from the roof
          </Toggle>
        )}
      </div>
    </>
  );
}
