import { lazy, Suspense, useState } from 'react';
import { Link, Navigate, Route, Routes, useParams } from 'react-router';

import { isActivityFrame } from '@/activity/frame';
import { AppShell } from '@/components/AppShell';
import { RequireAuth } from '@/components/RequireAuth';
import { CampaignPage } from '@/pages/CampaignPage';
import { CharacterSheetPage } from '@/pages/CharacterSheetPage';
import { DomainCardPage } from '@/pages/DomainCardPage';
import { DomainPage } from '@/pages/DomainPage';
import { EntryPage } from '@/pages/EntryPage';
import { GameplayPage } from '@/pages/GameplayPage';
import { HomePage } from '@/pages/HomePage';
import { ImportPage } from '@/pages/ImportPage';
import { ImportReviewPage } from '@/pages/ImportReviewPage';
import { JoinPage } from '@/pages/JoinPage';
import { ProfilePage } from '@/pages/ProfilePage';
import { RecordPage } from '@/pages/RecordPage';
import { RecordsPage } from '@/pages/RecordsPage';
import { ScenesPage } from '@/pages/ScenesPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { StatBlockPage } from '@/pages/StatBlockPage';
import { StatBlocksPage } from '@/pages/StatBlocksPage';
import { statBlockPath, statBlocksPath } from '@/lib/records';

// The stage brings Three.js with it, so it loads only when a stage page is opened (F3.1).
const StageTestPage = lazy(() =>
  import('@/pages/StageTestPage').then((module) => ({ default: module.StageTestPage })),
);

const SceneBuilderPage = lazy(() =>
  import('@/pages/SceneBuilderPage').then((module) => ({ default: module.SceneBuilderPage })),
);

// The table during a live session (F3.3): the theater, and Socket.IO for the live room.
const PlayPage = lazy(() =>
  import('@/pages/PlayPage').then((module) => ({ default: module.PlayPage })),
);

// Stagehand inside Discord's frame (F3.3c): it brings Discord's SDK with it.
const ActivityApp = lazy(() =>
  import('@/activity/ActivityApp').then((module) => ({ default: module.ActivityApp })),
);

// The Discord Activity test (governance §13) brings Discord's SDK and Socket.IO with it.
const ActivityTestPage = lazy(() =>
  import('@/pages/ActivityTestPage').then((module) => ({ default: module.ActivityTestPage })),
);

const stageFallback = <p className="p-4">Loading the stage…</p>;

export function App() {
  // Discord always opens an Activity at the root path, with launch parameters its SDK reads
  // from the URL. So inside Discord's frame the whole app is the Activity app, wherever the
  // router goes: sign-in through Discord, the player's campaigns and the table (F3.3c).
  // Decided once: later navigation drops the query.
  const [inFrame] = useState(() => isActivityFrame(window.location.search));
  if (inFrame) {
    return (
      <Suspense fallback={<p className="p-4">Loading…</p>}>
        <ActivityApp />
      </Suspense>
    );
  }

  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route
          path="/profile"
          element={
            <RequireAuth>
              <ProfilePage />
            </RequireAuth>
          }
        />
        <Route
          path="/settings"
          element={
            <RequireAuth>
              <SettingsPage />
            </RequireAuth>
          }
        />
        <Route
          path="/campaigns/:campaignId"
          element={
            <RequireAuth>
              <CampaignPage />
            </RequireAuth>
          }
        />
        <Route
          path="/campaigns/:campaignId/records"
          element={
            <RequireAuth>
              <RecordsPage />
            </RequireAuth>
          }
        />
        <Route
          path="/campaigns/:campaignId/records/:recordId"
          element={
            <RequireAuth>
              <RecordPage />
            </RequireAuth>
          }
        />
        <Route
          path="/campaigns/:campaignId/entries/:entryId"
          element={
            <RequireAuth>
              <EntryPage />
            </RequireAuth>
          }
        />
        <Route
          path="/campaigns/:campaignId/characters/:characterId"
          element={
            <RequireAuth>
              <CharacterSheetPage />
            </RequireAuth>
          }
        />
        <Route
          path="/campaigns/:campaignId/gameplay"
          element={
            <RequireAuth>
              <GameplayPage />
            </RequireAuth>
          }
        />
        <Route
          path="/campaigns/:campaignId/gameplay/domains/:domainId"
          element={
            <RequireAuth>
              <DomainPage />
            </RequireAuth>
          }
        />
        <Route
          path="/campaigns/:campaignId/gameplay/domain-cards/:cardId"
          element={
            <RequireAuth>
              <DomainCardPage />
            </RequireAuth>
          }
        />
        <Route
          path="/campaigns/:campaignId/gameplay/stat-blocks"
          element={
            <RequireAuth>
              <StatBlocksPage />
            </RequireAuth>
          }
        />
        <Route
          path="/campaigns/:campaignId/gameplay/stat-blocks/:statBlockId"
          element={
            <RequireAuth>
              <StatBlockPage />
            </RequireAuth>
          }
        />
        {/* Stat blocks moved into the gameplay section (F4.3): old links still work. */}
        <Route path="/campaigns/:campaignId/stat-blocks" element={<StatBlocksMoved />} />
        <Route
          path="/campaigns/:campaignId/stat-blocks/:statBlockId"
          element={<StatBlocksMoved />}
        />
        <Route
          path="/campaigns/:campaignId/scenes"
          element={
            <RequireAuth>
              <ScenesPage />
            </RequireAuth>
          }
        />
        <Route
          path="/campaigns/:campaignId/scenes/:sceneId"
          element={
            <RequireAuth>
              <Suspense fallback={stageFallback}>
                <SceneBuilderPage />
              </Suspense>
            </RequireAuth>
          }
        />
        <Route
          path="/campaigns/:campaignId/play"
          element={
            <RequireAuth>
              <Suspense fallback={stageFallback}>
                <PlayPage />
              </Suspense>
            </RequireAuth>
          }
        />
        <Route
          path="/campaigns/:campaignId/import"
          element={
            <RequireAuth>
              <ImportPage />
            </RequireAuth>
          }
        />
        <Route
          path="/campaigns/:campaignId/imports/:importId"
          element={
            <RequireAuth>
              <ImportReviewPage />
            </RequireAuth>
          }
        />
        <Route
          path="/stage-test"
          element={
            <RequireAuth>
              <Suspense fallback={stageFallback}>
                <StageTestPage />
              </Suspense>
            </RequireAuth>
          }
        />
        {/* Not behind RequireAuth: the test's probes need no Stagehand sign-in. */}
        <Route
          path="/activity-test"
          element={
            <Suspense fallback={stageFallback}>
              <ActivityTestPage inFrame={false} />
            </Suspense>
          }
        />
        {/* Not behind RequireAuth: signed-out visitors sign in from the page itself. */}
        <Route path="/join/:code" element={<JoinPage />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </AppShell>
  );
}

function NotFound() {
  return (
    <div className="space-y-2">
      <h1 className="text-2xl font-bold">Page not found</h1>
      <Link to="/" className="underline">
        Back to Stagehand
      </Link>
    </div>
  );
}

/** An old stat block link (before F4.3): the same page, now in the gameplay section. */
function StatBlocksMoved() {
  const { campaignId = '', statBlockId } = useParams();
  const to =
    statBlockId === undefined ? statBlocksPath(campaignId) : statBlockPath(campaignId, statBlockId);
  return <Navigate to={to} replace />;
}
