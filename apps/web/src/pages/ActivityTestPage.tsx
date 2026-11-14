import { useEffect, useState } from 'react';

import { ActivityPanel } from '@/activity/ActivityPanel';
import { activitySdk } from '@/activity/discord';
import { runProbes, type ProbeId, type ProbeResult } from '@/activity/probes';
import { formatActivityReport } from '@/activity/report';
import { runSocketProbe } from '@/activity/socket-probe';
import { StageTestPage } from '@/pages/StageTestPage';
import { browserName } from '@/stage/perf-report';

export const ACTIVITY_TEST_PATH = '/activity-test';

export const ACTIVITY_TEST_OFF_MESSAGE = 'The Activity test is not switched on on this server.';

/** One run of the probes. */
interface Run {
  results: Partial<Record<ProbeId, ProbeResult>>;
  speaking: { starts: number; stops: number };
  /** Who has been heard, to count them; never shown or reported. */
  heard: readonly string[];
  /** Null until the first probe has found out whether the server serves the test. */
  available: boolean | null;
  done: boolean;
}

const FRESH: Run = {
  results: {},
  speaking: { starts: 0, stops: 0 },
  heard: [],
  available: null,
  done: false,
};

/**
 * The Discord Activity test (governance §13, the spike after F3.1): the stage test with a
 * second panel of probes that find out what works inside Discord's frame. Shown at
 * `/activity-test` in a normal tab, where the Discord probes are skipped, and in place of the
 * whole app when Discord opens Stagehand as an Activity. It needs no Stagehand sign-in:
 * there is none inside Discord yet.
 */
export function ActivityTestPage({ inFrame }: { inFrame: boolean }) {
  const [attempt, setAttempt] = useState(0);
  const [run, setRun] = useState<Run>(FRESH);
  const [stageLine, setStageLine] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let endSpeaking: (() => void) | null = null;

    void runProbes(
      {
        // Looked up on each call, so it is always the page's current `fetch`.
        fetch: (input, init) => fetch(input, init),
        inFrame,
        pageUrl: window.location.pathname + window.location.search,
        sdk: activitySdk,
        socketProbe: runSocketProbe,
        now: () => performance.now(),
      },
      {
        cancelled: () => cancelled,
        result: (id, result) => {
          if (cancelled) return;
          setRun((current) => ({ ...current, results: { ...current.results, [id]: result } }));
        },
        speaking: (kind, userId) => {
          if (cancelled) return;
          setRun((current) => ({
            ...current,
            speaking: {
              starts: current.speaking.starts + (kind === 'start' ? 1 : 0),
              stops: current.speaking.stops + (kind === 'stop' ? 1 : 0),
            },
            heard: current.heard.includes(userId) ? current.heard : [...current.heard, userId],
          }));
        },
        cleanup: (dispose) => {
          if (cancelled) dispose();
          else endSpeaking = dispose;
        },
      },
    ).then((available) => {
      if (!cancelled) setRun((current) => ({ ...current, available, done: true }));
    });

    return () => {
      cancelled = true;
      endSpeaking?.();
    };
  }, [attempt, inFrame]);

  const speaking = { ...run.speaking, people: run.heard.length };

  if (run.available === false) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center">
        <div className="space-y-2">
          <h1 className="text-xl font-bold">Activity test</h1>
          <p>{ACTIVITY_TEST_OFF_MESSAGE}</p>
          {run.results.paths !== undefined && (
            <p className="text-sm text-white/70">{run.results.paths.detail}</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full">
      <StageTestPage onResult={setStageLine} />
      <ActivityPanel
        results={run.results}
        done={run.done}
        speaking={speaking}
        report={formatActivityReport({
          inFrame,
          browser: browserName(navigator.userAgent),
          results: run.results,
          speaking,
          stageLine,
        })}
        onRunAgain={() => {
          setRun(FRESH);
          setAttempt((count) => count + 1);
        }}
      />
    </div>
  );
}
