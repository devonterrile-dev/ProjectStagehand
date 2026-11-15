import { lazy, Suspense, useState } from 'react';
import { Link, Route, Routes } from 'react-router';

import { isActivityFrame } from '@/activity/frame';
import { AppShell, StageShell } from '@/components/AppShell';
import { RequireAuth } from '@/components/RequireAuth';
import { CampaignPage } from '@/pages/CampaignPage';
import { CharacterSheetPage } from '@/pages/CharacterSheetPage';
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

// The stage brings Three.js with it, so it loads only when a stage page is opened (F3.1).
const StageTestPage = lazy(() =>
  import('@/pages/StageTestPage').then((module) => ({ default: module.StageTestPage })),
);

const SceneBuilderPage = lazy(() =>
  import('@/pages/SceneBuilderPage').then((module) => ({ default: module.SceneBuilderPage })),
);

// The Discord Activity test (governance §13) brings Discord's SDK and Socket.IO with it.
const ActivityTestPage = lazy(() =>
  import('@/pages/ActivityTestPage').then((module) => ({ default: module.ActivityTestPage })),
);

const stageFallback = <p className="p-4">Loading the stage…</p>;

export function App() {
  // Discord always opens an Activity at the root path, with launch parameters its SDK reads
  // from the URL. So inside Discord's frame the whole app is the Activity test, wherever the
  // router goes. Decided once: later navigation drops the query.
  const [inFrame] = useState(() => isActivityFrame(window.location.search));
  if (inFrame) {
    return (
      <StageShell>
        <Suspense fallback={stageFallback}>
          <ActivityTestPage inFrame />
        </Suspense>
      </StageShell>
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
          path="/campaigns/:campaignId/characters/:characterId"
          element={
            <RequireAuth>
              <CharacterSheetPage />
            </RequireAuth>
          }
        />
        <Route
          path="/campaigns/:campaignId/stat-blocks"
          element={
            <RequireAuth>
              <StatBlocksPage />
            </RequireAuth>
          }
        />
        <Route
          path="/campaigns/:campaignId/stat-blocks/:statBlockId"
          element={
            <RequireAuth>
              <StatBlockPage />
            </RequireAuth>
          }
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
        {/* Not behind RequireAuth: there is no Stagehand sign-in inside Discord yet. */}
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
