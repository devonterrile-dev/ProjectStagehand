import { STAGE_MAX_OBJECTS } from '@stagehand/shared';
import { useCallback, useState, type ReactNode } from 'react';
import { Link } from 'react-router';

import { Button } from '@/components/ui/button';
import { summarizeFrames } from '@/stage/frame-stats';
import { browserName, formatReport } from '@/stage/perf-report';
import { PerfPanel } from '@/stage/PerfPanel';
import type { LiveStats } from '@/stage/PerfProbe';
import { MAX_PIXEL_RATIO, PIXEL_RATIO_CHOICES } from '@/stage/quality';
import { SAMPLE_BACKDROPS } from '@/stage/samples';
import { StageTestCanvas } from '@/stage/StageTestCanvas';

export const STAGE_TEST_PATH = '/stage-test';

/** How long one measurement runs. */
export const MEASURE_SECONDS = 30;

const OBJECT_COUNTS = [0, 10, 20, STAGE_MAX_OBJECTS] as const;

export const NO_FRAMES_MESSAGE =
  'No frames were drawn during the measurement. Keep this tab in front and try again.';

/** A measurement: the run in progress (and what it is measuring), and the last result. */
interface Measurement {
  /** How many runs have been started; the next run's id. */
  started: number;
  run: { id: number; seconds: number; objects: number } | null;
  result: string | null;
}

/** A labelled row of either-or buttons. */
function Choice<T extends string | number>({
  label,
  options,
  value,
  disabled = false,
  onChange,
}: {
  label: string;
  options: readonly { label: string; value: T }[];
  value: T;
  disabled?: boolean;
  onChange: (value: T) => void;
}): ReactNode {
  return (
    <div role="group" aria-label={label} className="flex items-center gap-1.5">
      <span aria-hidden>{label}</span>
      {options.map((option) => (
        <Button
          key={option.label}
          size="xs"
          variant={option.value === value ? 'default' : 'secondary'}
          aria-pressed={option.value === value}
          disabled={disabled}
          onClick={() => {
            onChange(option.value);
          }}
        >
          {option.label}
        </Button>
      ))}
    </div>
  );
}

/**
 * `/stage-test`: the tabletop theater on its own, with bundled sample art and a performance
 * test scene (F3.1, governance §12 "Performance budget"). It needs no campaign, so anyone
 * signed in can open it to see how the stage looks and runs on their device, and send back a
 * one-line measurement. Rendered inside RequireAuth and loaded lazily, so Three.js stays out
 * of the main bundle.
 */
export function StageTestPage() {
  const [backdropName, setBackdropName] = useState(SAMPLE_BACKDROPS[0]?.name ?? '');
  const [curtainOpen, setCurtainOpen] = useState(true);
  const [objectCount, setObjectCount] = useState<number>(STAGE_MAX_OBJECTS);
  const [sway, setSway] = useState(true);
  const [maxPixelRatio, setMaxPixelRatio] = useState<number>(MAX_PIXEL_RATIO);
  const [live, setLive] = useState<LiveStats | null>(null);
  const [measurement, setMeasurement] = useState<Measurement>({
    started: 0,
    run: null,
    result: null,
  });

  const backdrop = SAMPLE_BACKDROPS.find((sample) => sample.name === backdropName) ?? null;
  const measuring = measurement.run !== null;

  // Stable, so the canvas isn't re-rendered each time live numbers arrive.
  const onMeasured = useCallback((id: number, frameSeconds: number[], at: LiveStats) => {
    setMeasurement((current) => {
      if (current.run?.id !== id) return current;
      const summary = summarizeFrames(frameSeconds);
      return {
        started: current.started,
        run: null,
        result:
          summary === null
            ? NO_FRAMES_MESSAGE
            : formatReport({
                objects: current.run.objects,
                browser: browserName(navigator.userAgent),
                gpu: at.gpu,
                width: at.width,
                height: at.height,
                pixelRatio: at.pixelRatio,
                summary,
              }),
      };
    });
  }, []);

  return (
    <div className="relative h-full w-full">
      <h1 className="sr-only">Stage test</h1>
      <StageTestCanvas
        backdropUrl={backdrop?.url ?? null}
        curtainOpen={curtainOpen}
        objectCount={objectCount}
        sway={sway}
        maxPixelRatio={maxPixelRatio}
        measure={measurement.run}
        onLive={setLive}
        onMeasured={onMeasured}
      />

      <PerfPanel
        live={live}
        measureSeconds={MEASURE_SECONDS}
        measuring={measuring}
        result={measurement.result}
        onMeasure={() => {
          setMeasurement((current) => ({
            started: current.started + 1,
            run: { id: current.started + 1, seconds: MEASURE_SECONDS, objects: objectCount },
            result: current.result,
          }));
        }}
      />

      <div className="absolute bottom-3 left-3 flex max-w-[calc(100%-1.5rem)] flex-wrap items-center gap-x-4 gap-y-2 rounded-md bg-black/70 px-3 py-2 text-sm text-white">
        <Link to="/" className="underline">
          ← Stagehand
        </Link>
        {/* What is being measured stays put while a measurement runs. */}
        <Choice
          label="Objects"
          options={OBJECT_COUNTS.map((value) => ({ label: String(value), value }))}
          value={objectCount}
          disabled={measuring}
          onChange={setObjectCount}
        />
        <Choice
          label="Sharpness"
          options={PIXEL_RATIO_CHOICES}
          value={maxPixelRatio}
          disabled={measuring}
          onChange={setMaxPixelRatio}
        />
        <Choice
          label="Backdrop"
          options={SAMPLE_BACKDROPS.map((sample) => ({ label: sample.label, value: sample.name }))}
          value={backdropName}
          onChange={setBackdropName}
        />
        <Button
          size="xs"
          variant="secondary"
          aria-pressed={sway}
          disabled={measuring}
          onClick={() => {
            setSway((on) => !on);
          }}
        >
          {sway ? 'Stop swaying' : 'Sway puppets'}
        </Button>
        <Button
          size="xs"
          variant="secondary"
          onClick={() => {
            setCurtainOpen((open) => !open);
          }}
        >
          {curtainOpen ? 'Close curtain' : 'Open curtain'}
        </Button>
      </div>
    </div>
  );
}
