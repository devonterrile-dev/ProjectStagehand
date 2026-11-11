import { Link, Route, Routes } from 'react-router';

import { AppShell } from '@/components/AppShell';
import { RequireAuth } from '@/components/RequireAuth';
import { CampaignPage } from '@/pages/CampaignPage';
import { CharacterSheetPage } from '@/pages/CharacterSheetPage';
import { HomePage } from '@/pages/HomePage';
import { JoinPage } from '@/pages/JoinPage';
import { ProfilePage } from '@/pages/ProfilePage';
import { RecordPage } from '@/pages/RecordPage';
import { RecordsPage } from '@/pages/RecordsPage';
import { StatBlockPage } from '@/pages/StatBlockPage';
import { StatBlocksPage } from '@/pages/StatBlocksPage';

export function App() {
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
