import { useState } from 'react';

import { Button } from '@/components/ui/button';

import { PROBE_IDS, PROBE_LABELS, type ProbeId, type ProbeResult } from './probes';
import { formatSpeaking, type SpeakingCounts } from './report';

export interface ActivityPanelProps {
  results: Partial<Record<ProbeId, ProbeResult>>;
  /** False while probes are still running. */
  done: boolean;
  speaking: SpeakingCounts;
  /** The whole result as text, for copying. */
  report: string;
  onRunAgain: () => void;
}

/** What to show for a probe that has no result yet: the first one without is the one running. */
function pendingWord(id: ProbeId, results: ActivityPanelProps['results'], done: boolean): string {
  if (done) return 'not run';
  const next = PROBE_IDS.find((probe) => results[probe] === undefined);
  return next === id ? 'running…' : 'waiting';
}

/**
 * The Activity test's panel (governance §13): each probe with what it found, and the whole
 * result as text to copy and send back.
 */
export function ActivityPanel({ results, done, speaking, report, onRunAgain }: ActivityPanelProps) {
  const [open, setOpen] = useState(true);
  const [copied, setCopied] = useState<string | null>(null);

  function copy(text: string) {
    // The clipboard may be refused inside a frame; the box below can be copied by hand.
    navigator.clipboard.writeText(text).then(
      () => {
        setCopied(text);
      },
      () => {
        setCopied(null);
      },
    );
  }

  return (
    <section
      aria-label="Activity test"
      className="absolute top-3 left-3 max-h-[calc(100%-6rem)] w-80 max-w-[calc(100%-1.5rem)] space-y-2 overflow-y-auto rounded-md bg-black/70 px-3 py-2 text-sm text-white"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-bold">Activity test</h2>
        <Button
          size="xs"
          variant="secondary"
          aria-expanded={open}
          onClick={() => {
            setOpen((value) => !value);
          }}
        >
          {open ? 'Hide' : 'Show'}
        </Button>
      </div>

      {open && (
        <>
          <ul className="space-y-1 text-xs">
            {PROBE_IDS.map((id) => {
              const result = results[id];
              return (
                <li key={id} aria-label={PROBE_LABELS[id]}>
                  <span className="font-medium">{PROBE_LABELS[id]}:</span>{' '}
                  <span
                    className={
                      result?.status === 'failed'
                        ? 'font-bold text-red-300'
                        : result?.status === 'ok'
                          ? 'font-bold text-green-300'
                          : 'text-white/70'
                    }
                  >
                    {result?.status ?? pendingWord(id, results, done)}
                  </span>
                  {result !== undefined && (
                    <span className="block break-words text-white/80">{result.detail}</span>
                  )}
                  {id === 'speaking' && result?.status === 'ok' && (
                    <span className="block text-white/80" aria-label="Speaking events heard">
                      {formatSpeaking(speaking)}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>

          <div className="space-y-1">
            <label className="block text-xs" htmlFor="activity-test-report">
              Report
            </label>
            <textarea
              id="activity-test-report"
              readOnly
              rows={5}
              value={report}
              className="w-full resize-none rounded border border-white/30 bg-black/40 p-1.5 text-xs"
              onFocus={(event) => {
                event.currentTarget.select();
              }}
            />
            <div className="flex gap-2">
              <Button
                size="xs"
                variant="secondary"
                disabled={!done}
                onClick={() => {
                  copy(report);
                }}
              >
                {copied === report ? 'Copied' : 'Copy report'}
              </Button>
              <Button size="xs" variant="secondary" disabled={!done} onClick={onRunAgain}>
                Run again
              </Button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
