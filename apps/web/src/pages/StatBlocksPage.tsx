import { STAT_BLOCK_NAME_MAX, statBlockNameSchema, type Campaign } from '@stagehand/shared';
import { PlusIcon } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';

import { CampaignNameDialog } from '@/components/campaigns/CampaignNameDialog';
import { GmOnlyNote } from '@/components/stat-blocks/GmOnlyNote';
import { StatBlockList } from '@/components/stat-blocks/StatBlockList';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useCampaign, useCreateStatBlock, useStatBlocks } from '@/lib/queries';
import { statBlockPath } from '@/lib/records';
import { CampaignNotFound } from '@/pages/CampaignPage';

/** `/campaigns/:campaignId/stat-blocks`: the GM's monsters and fighting NPCs. */
export function StatBlocksPage() {
  const { campaignId = '' } = useParams();
  const { data: campaign, isPending, isError } = useCampaign(campaignId);

  if (isPending) return <p className="text-muted-foreground">Loading…</p>;
  if (isError) return <p role="alert">Could not load this campaign. Try again in a moment.</p>;
  if (campaign === null) return <CampaignNotFound />;
  return <StatBlocksView campaign={campaign} />;
}

function StatBlocksView({ campaign }: { campaign: Campaign }) {
  const isGm = campaign.role === 'gm';
  const isArchived = campaign.archivedAt !== null;
  const { data: statBlocks, isPending, isError } = useStatBlocks(campaign.id, isGm);
  const create = useCreateStatBlock(campaign.id);
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);

  return (
    <div className="space-y-4">
      <Link
        to={`/campaigns/${campaign.id}`}
        className="text-sm text-muted-foreground hover:underline"
      >
        ← {campaign.name}
      </Link>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <CardTitle>
            <h1 className="text-2xl">Stat blocks</h1>
          </CardTitle>
          {isGm && !isArchived && (
            <Button
              size="sm"
              onClick={() => {
                setCreating(true);
              }}
            >
              <PlusIcon aria-hidden />
              New stat block
            </Button>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          {!isGm && <GmOnlyNote />}
          {isGm && isPending && <p className="text-muted-foreground">Loading stat blocks…</p>}
          {isGm && isError && (
            <p role="alert">Could not load the stat blocks. Try again in a moment.</p>
          )}
          {isGm && statBlocks !== undefined && (
            <StatBlockList campaignId={campaign.id} statBlocks={statBlocks} />
          )}
        </CardContent>
      </Card>

      <CampaignNameDialog
        open={creating}
        onOpenChange={setCreating}
        title="New stat block"
        description="A monster or a fighting NPC. You can fill in the rest after."
        submitLabel="Create stat block"
        label="Name"
        schema={statBlockNameSchema}
        maxLength={STAT_BLOCK_NAME_MAX}
        onSave={async (name) => {
          const block = await create.mutateAsync({ name });
          void navigate(statBlockPath(campaign.id, block.id));
        }}
      />
    </div>
  );
}
