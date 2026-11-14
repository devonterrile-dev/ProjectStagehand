import { useState } from 'react';

import { Button } from '@/components/ui/button';

import type { LiveStats } from './PerfProbe';

export interface PerfPanelProps {
  /** Null until the stage has drawn for a moment. */
  live: LiveStats | null;
  /** How long a measurement runs, in seconds. */
  measureSeconds: number;
  measuring: boolean;
  /** The last measurement's one-line result. */
  result: string | null;
  onMeasure: () => void;
}

const count = (value: number): string => Math.round(value).toLocaleString('en-US');

/**
 * The stage test page's performance panel (F3.1): how smoothly the stage is running right
 * now, and a timed measurement whose one-line result can be copied and sent to the GM.
 */
export function PerfPanel({ live, measureSeconds, measuring, result, onMeasure }: PerfPanelProps) {
  const [copied, setCopied] = useState<string | null>(null);

  function copy(text: string) {
    // The clipboard needs https (or localhost) and permission; the box below can always be
    // selected and copied by hand.
    navigator.clipboard.writeText(text).then(
      () => {
        setCopied(text);
      },
      () => {
        setCopied(null);
      },
    );
  }

  const left = live?.measuringLeft ?? null;

  return (
    <section
      aria-label="Performance"
      className="absolute top-3 right-3 w-72 max-w-[calc(100%-1.5rem)] space-y-2 rounded-md bg-black/70 px-3 py-2 text-sm text-white"
    >
      {live === null ? (
        <p>Starting the stage…</p>
      ) : (
        <>
          <p className="text-2xl font-bold tabular-nums" aria-label="Frames per second">
            {count(live.fps)} <span className="text-sm font-normal">fps</span>
          </p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 text-xs tabular-nums">
            <dt>Draw calls</dt>
            <dd>{count(live.drawCalls)}</dd>
            <dt>Triangles</dt>
            <dd>{count(live.triangles)}</dd>
            <dt>Textures</dt>
            <dd>{count(live.textures)}</dd>
            <dt>Size</dt>
            <dd>
              {count(live.width)} × {count(live.height)} at {Number(live.pixelRatio.toFixed(2))}x
            </dd>
          </dl>
          <p className="text-xs break-words text-white/70">{live.gpu}</p>
        </>
      )}

      <Button
        size="xs"
        variant="secondary"
        disabled={measuring || live === null}
        onClick={onMeasure}
      >
        {measuring
          ? `Measuring… ${left === null ? '' : `${String(Math.ceil(left))} s left`}`.trim()
          : `Measure ${String(measureSeconds)} s`}
      </Button>

      {result !== null && !measuring && (
        <div className="space-y-1">
          <label className="block text-xs" htmlFor="stage-test-result">
            Result
          </label>
          <textarea
            id="stage-test-result"
            readOnly
            rows={4}
            value={result}
            className="w-full resize-none rounded border border-white/30 bg-black/40 p-1.5 text-xs"
            onFocus={(event) => {
              event.currentTarget.select();
            }}
          />
          <Button
            size="xs"
            variant="secondary"
            onClick={() => {
              copy(result);
            }}
          >
            {copied === result ? 'Copied' : 'Copy result'}
          </Button>
        </div>
      )}
    </section>
  );
}
