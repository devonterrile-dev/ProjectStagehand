import type { Campaign, PlaySession } from '@stagehand/shared';
import { useEffect } from 'react';
import { Link, useNavigate } from 'react-router';

import { CampaignRoleBadge } from '@/components/campaigns/CampaignRoleBadge';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useCampaigns, usePlaySessions } from '@/lib/queries';
import { playPath } from '@/play/stage';

import { firstArrival } from './enter';

function CampaignRow({ campaign, session }: { campaign: Campaign; session: PlaySession | null }) {
  const isGm = campaign.role === 'gm';
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4">
        <div className="space-y-1.5">
          <CardTitle className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg">{campaign.name}</h2>
            <CampaignRoleBadge role={campaign.role} />
          </CardTitle>
          <CardDescription>
            {session === null
              ? 'No session right now.'
              : `Session ${String(session.number)} is running.`}
          </CardDescription>
        </div>
        {session === null ? (
          <Button asChild size="sm" variant="outline">
            <Link to={`/campaigns/${campaign.id}`}>Open</Link>
          </Button>
        ) : (
          <Button asChild size="sm">
            <Link to={playPath(campaign.id)} aria-label={`Go to the table: ${campaign.name}`}>
              {isGm ? 'Open the stage' : 'Join the session'}
            </Link>
          </Button>
        )}
      </CardHeader>
    </Card>
  );
}

/**
 * The first page inside Discord (F3.3c): the player's campaigns and where a session is on. If
 * exactly one has a session running, the player is taken to its table on arrival. Building a
 * campaign stays in the browser (governance §13).
 */
export function ActivityHome({ test }: { test: boolean }) {
  const navigate = useNavigate();
  const campaigns = useCampaigns();
  const active = (campaigns.data ?? []).filter((campaign) => campaign.archivedAt === null);
  const sessions = usePlaySessions(active.map((campaign) => campaign.id));

  const settled = campaigns.isSuccess && sessions.every((query) => !query.isPending);
  const running = active.filter((_campaign, index) => sessions[index]?.data != null);
  const onlyTable = settled && running.length === 1 ? (running[0]?.id ?? null) : null;

  // Going to the table by itself happens once, on arrival.
  useEffect(() => {
    if (settled && firstArrival() && onlyTable !== null) void navigate(playPath(onlyTable));
  }, [settled, onlyTable, navigate]);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Stagehand</h1>
      {campaigns.isPending && <p className="text-muted-foreground">Loading your campaigns…</p>}
      {campaigns.isError && (
        <p role="alert">Could not load your campaigns. Try again in a moment.</p>
      )}
      {campaigns.isSuccess && active.length === 0 && (
        <p>
          You&apos;re not in a campaign yet. Open the invite link from your GM in a browser, then
          come back here.
        </p>
      )}
      <ul aria-label="Your campaigns" className="space-y-3">
        {active.map((campaign, index) => (
          <li key={campaign.id}>
            <CampaignRow campaign={campaign} session={sessions[index]?.data ?? null} />
          </li>
        ))}
      </ul>
      {test && (
        <p className="text-sm text-muted-foreground">
          <Link to="/activity-test" className="underline">
            Activity test
          </Link>
        </p>
      )}
    </div>
  );
}
