import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { Route, Routes } from 'react-router';

import { StageShell } from '@/components/AppShell';
import { Button } from '@/components/ui/button';

import { ActivityCampaign } from './ActivityCampaign';
import { ActivityHome } from './ActivityHome';
import { activitySdk } from './discord';
import { enterOnce, ENTRY_MESSAGES, type ActivityEntry } from './enter';

const PlayPage = lazy(() =>
  import('@/pages/PlayPage').then((module) => ({ default: module.PlayPage })),
);
const ActivityTestPage = lazy(() =>
  import('@/pages/ActivityTestPage').then((module) => ({ default: module.ActivityTestPage })),
);

const stageFallback = <p className="p-4">Loading the stage…</p>;

/** A page of the Activity that is not the stage: dark, narrow, and it may scroll. */
function Page({ children }: { children: ReactNode }) {
  return (
    <main className="dark min-h-svh bg-background px-4 py-6 text-foreground">
      <div className="mx-auto max-w-xl">{children}</div>
    </main>
  );
}

/**
 * Stagehand inside Discord's Activity frame (F3.3c, governance §13, D-51), in place of the
 * whole app: sign in through Discord's SDK, then the player's campaigns and the table. The
 * workshop (records, scenes, AI import) has no routes here: it stays in the browser.
 */
export function ActivityApp() {
  const [attempt, setAttempt] = useState(0);
  const [entry, setEntry] = useState<{ attempt: number; result: ActivityEntry } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void enterOnce(attempt, {
      // Looked up on each call, so it is always the page's current `fetch`.
      fetch: (input, init) => fetch(input, init),
      sdk: activitySdk,
    }).then((result) => {
      if (!cancelled) setEntry({ attempt, result });
    });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const result = entry?.attempt === attempt ? entry.result : null;
  const tryAgain = (
    <Button
      onClick={() => {
        setAttempt((count) => count + 1);
      }}
    >
      Try again
    </Button>
  );

  if (result === null) {
    return (
      <Page>
        <p>Signing you in with Discord…</p>
      </Page>
    );
  }
  if (result.status === 'test-only') {
    // The test page finds out by itself what this server serves, and says so if nothing.
    return (
      <StageShell>
        <Suspense fallback={stageFallback}>
          <ActivityTestPage inFrame />
        </Suspense>
      </StageShell>
    );
  }
  if (result.status === 'no-account') {
    return (
      <Page>
        <div className="space-y-4">
          <h1 className="text-2xl font-bold">You&apos;re new here</h1>
          <p>{result.message}</p>
          {tryAgain}
        </div>
      </Page>
    );
  }
  if (result.status === 'cookie-blocked' || result.status === 'failed') {
    return (
      <Page>
        <div className="space-y-4">
          <h1 className="text-2xl font-bold">Couldn&apos;t sign you in</h1>
          <p role="alert">
            {result.status === 'failed' ? result.message : ENTRY_MESSAGES.cookieBlocked}
          </p>
          {tryAgain}
        </div>
      </Page>
    );
  }

  const table = (
    <StageShell>
      <Suspense fallback={stageFallback}>
        <PlayPage />
      </Suspense>
    </StageShell>
  );
  return (
    <Routes>
      <Route path="/campaigns/:campaignId/play" element={table} />
      <Route
        path="/campaigns/:campaignId"
        element={
          <Page>
            <ActivityCampaign />
          </Page>
        }
      />
      {result.test && (
        <Route
          path="/activity-test"
          element={
            <StageShell>
              <Suspense fallback={stageFallback}>
                <ActivityTestPage inFrame />
              </Suspense>
            </StageShell>
          }
        />
      )}
      {/* Discord opens the Activity at the root path; anything unknown is the list too. */}
      <Route
        path="*"
        element={
          <Page>
            <ActivityHome test={result.test} />
          </Page>
        }
      />
    </Routes>
  );
}
