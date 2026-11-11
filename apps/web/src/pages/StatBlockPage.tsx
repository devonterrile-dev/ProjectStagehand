import { Link, useNavigate, useParams } from 'react-router';

import { GmOnlyNote } from '@/components/stat-blocks/GmOnlyNote';
import { StatBlockForm } from '@/components/stat-blocks/StatBlockForm';
import { useCampaign, useStatBlock } from '@/lib/queries';
import { useRememberRecent } from '@/lib/recent-items';
import { statBlocksPath } from '@/lib/records';
import { CampaignNotFound } from '@/pages/CampaignPage';

/** `/campaigns/:campaignId/stat-blocks/:statBlockId`: one stat block, autosaving. GM only. */
export function StatBlockPage() {
  const { campaignId = '', statBlockId = '' } = useParams();
  const campaignQuery = useCampaign(campaignId);
  const isGm = campaignQuery.data?.role === 'gm';
  const blockQuery = useStatBlock(campaignId, statBlockId, isGm);
  const navigate = useNavigate();
  const loaded = blockQuery.data ?? null;
  useRememberRecent(campaignId, loaded === null ? null : { kind: 'statBlock', id: loaded.id });

  if (campaignQuery.isPending) return <p className="text-muted-foreground">Loading…</p>;
  if (campaignQuery.isError) {
    return <p role="alert">Could not load this campaign. Try again in a moment.</p>;
  }
  const campaign = campaignQuery.data;
  if (campaign === null) return <CampaignNotFound />;

  const backLink = (
    <Link
      to={statBlocksPath(campaign.id)}
      className="text-sm text-muted-foreground hover:underline"
    >
      ← Stat blocks
    </Link>
  );

  if (!isGm) {
    return (
      <div className="space-y-4">
        {backLink}
        <GmOnlyNote />
      </div>
    );
  }
  if (blockQuery.isPending) return <p className="text-muted-foreground">Loading stat block…</p>;
  if (blockQuery.isError) {
    return <p role="alert">Could not load this stat block. Try again in a moment.</p>;
  }
  const statBlock = blockQuery.data;
  if (statBlock === null) {
    return (
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">Stat block not found</h1>
        <p className="text-muted-foreground">It may have been deleted.</p>
        <Link to={statBlocksPath(campaign.id)} className="underline">
          Back to stat blocks
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {backLink}
      {campaign.archivedAt !== null && (
        <div className="rounded-md border bg-muted px-4 py-3 text-sm">
          This campaign is archived, so its stat blocks are read-only.
        </div>
      )}
      <StatBlockForm
        key={statBlock.id}
        campaign={campaign}
        statBlock={statBlock}
        onDeleted={() => {
          void navigate(statBlocksPath(campaign.id), { replace: true });
        }}
      />
    </div>
  );
}
