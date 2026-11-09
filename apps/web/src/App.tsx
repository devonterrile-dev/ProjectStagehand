import { Link, Route, Routes } from 'react-router';

import { AppShell } from '@/components/AppShell';
import { RequireAuth } from '@/components/RequireAuth';
import { CampaignPage } from '@/pages/CampaignPage';
import { HomePage } from '@/pages/HomePage';
import { ProfilePage } from '@/pages/ProfilePage';

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
