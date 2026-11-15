import { Link, useParams } from 'react-router';

import { CampaignRoleBadge } from '@/components/campaigns/CampaignRoleBadge';
import { SessionCard } from '@/components/play/SessionCard';
import { useCampaign } from '@/lib/queries';

/**
 * One campaign inside Discord (F3.3c): its session, to start, join or end. Everything else a
 * campaign page has in a browser (records, scenes, members) stays there.
 */
export function ActivityCampaign() {
  const { campaignId = '' } = useParams();
  const { data: campaign, isPending, isError } = useCampaign(campaignId);

  const back = (
    <Link to="/" className="text-sm text-muted-foreground hover:underline">
      ← All campaigns
    </Link>
  );
  if (isPending) return <p className="text-muted-foreground">Loading…</p>;
  if (isError) return <p role="alert">Could not load this campaign. Try again in a moment.</p>;
  if (campaign === null) {
    return (
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">Campaign not found</h1>
        {back}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {back}
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold">{campaign.name}</h1>
        <CampaignRoleBadge role={campaign.role} />
      </div>
      <SessionCard campaign={campaign} />
      {campaign.role === 'gm' && (
        <p className="text-sm text-muted-foreground">
          Records, scenes and images are made in Stagehand in a browser.
        </p>
      )}
    </div>
  );
}
