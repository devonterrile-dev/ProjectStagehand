import {
  EMOTE_LABELS,
  EMOTES,
  STAGE_MAX_OBJECTS,
  type BattleSize,
  type Emote,
} from '@stagehand/shared';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router';

import { VoiceControl } from '@/components/play/VoiceControl';
import { Button } from '@/components/ui/button';
import { createMic } from '@/play/mic';
import { useSpeaking } from '@/play/speaking';
import { summarizeFrames } from '@/stage/frame-stats';
import { browserName, formatReport } from '@/stage/perf-report';
import { PerfPanel } from '@/stage/PerfPanel';
import type { LiveStats } from '@/stage/PerfProbe';
import { MAX_PIXEL_RATIO, PIXEL_RATIO_CHOICES } from '@/stage/quality';
import type { EmoteCue } from '@/stage/Cutout';
import { SAMPLE_BACKDROPS } from '@/stage/samples';
import { StageTestCanvas } from '@/stage/StageTestCanvas';

export const STAGE_TEST_PATH = '/stage-test';

/** How long one measurement runs. */
export const MEASURE_SECONDS = 30;

const OBJECT_COUNTS = [0, 10, 20, STAGE_MAX_OBJECTS] as const;

/** A battle mat to lay out (F5.5), or none. */
const BATTLE_CHOICES: readonly { label: string; value: BattleSize | 'off' }[] = [
  { label: 'Off', value: 'off' },
  { label: 'Small', value: 'small' },
  { label: 'Medium', value: 'medium' },
  { label: 'Large', value: 'large' },
];

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
 *
 * `onResult` is told the last measurement's result line (null before the first), for a page
 * that shows the stage test inside something larger: the Activity test.
 */
/** The table's mic on the test page (F3.9): tune the sensitivity without a session. */
function MicTest({ onTalking }: { onTalking: (talking: boolean) => void }) {
  const [mic] = useState(() => createMic());
  useSpeaking(onTalking, mic);
  return <VoiceControl voice={{ from: 'mic', mic }} />;
}

export function StageTestPage({ onResult }: { onResult?: (line: string | null) => void } = {}) {
  const [backdropName, setBackdropName] = useState(SAMPLE_BACKDROPS[0]?.name ?? '');
  const [curtainOpen, setCurtainOpen] = useState(true);
  const [objectCount, setObjectCount] = useState<number>(STAGE_MAX_OBJECTS);
  const [sway, setSway] = useState(true);
  // A transition scene's travel (F5.4): scroll, walk and a prop passing by.
  const [travel, setTravel] = useState(false);
  // A battle on the table (F5.5): the mat and a token for each object.
  const [battle, setBattle] = useState<BattleSize | 'off'>('off');
  // Puppet motion (F3.7): every puppet talks, or plays the chosen emote, at once.
  const [talking, setTalking] = useState(false);
  const [micOn, setMicOn] = useState(false);
  const [micTalking, setMicTalking] = useState(false);
  const [emoteChoice, setEmoteChoice] = useState<Emote>(EMOTES[0]);
  const [emote, setEmote] = useState<EmoteCue | null>(null);
  const [maxPixelRatio, setMaxPixelRatio] = useState<number>(MAX_PIXEL_RATIO);
  const [live, setLive] = useState<LiveStats | null>(null);
  const [measurement, setMeasurement] = useState<Measurement>({
    started: 0,
    run: null,
    result: null,
  });

  const result = measurement.result;
  useEffect(() => {
    onResult?.(result);
  }, [onResult, result]);

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
        talking={talking || micTalking}
        emote={emote}
        travel={travel}
        battle={battle === 'off' ? null : battle}
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
        <Choice label="Battle" options={BATTLE_CHOICES} value={battle} onChange={setBattle} />
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
          aria-pressed={travel}
          onClick={() => {
            setTravel((on) => !on);
          }}
        >
          {travel ? 'Stop travelling' : 'Travel'}
        </Button>
        <Button
          size="xs"
          variant="secondary"
          aria-pressed={talking}
          onClick={() => {
            setTalking((on) => !on);
          }}
        >
          {talking ? 'Stop talking' : 'Talk'}
        </Button>
        <Button
          size="xs"
          variant="secondary"
          aria-pressed={micOn}
          onClick={() => {
            setMicOn((on) => !on);
          }}
        >
          {micOn ? 'Stop the mic' : 'Mic'}
        </Button>
        {micOn && <MicTest onTalking={setMicTalking} />}
        <div className="flex items-center gap-1.5">
          <label htmlFor="stage-test-emote">Emote</label>
          <select
            id="stage-test-emote"
            className="rounded bg-white/10 px-1 py-0.5"
            value={emoteChoice}
            onChange={(event) => {
              setEmoteChoice(event.target.value as Emote);
            }}
          >
            {EMOTES.map((option) => (
              <option key={option} value={option} className="text-black">
                {EMOTE_LABELS[option]}
              </option>
            ))}
          </select>
          <Button
            size="xs"
            variant="secondary"
            onClick={() => {
              setEmote((last) => ({
                id: String(Number(last?.id ?? 0) + 1),
                emote: emoteChoice,
              }));
            }}
          >
            Play
          </Button>
        </div>
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
