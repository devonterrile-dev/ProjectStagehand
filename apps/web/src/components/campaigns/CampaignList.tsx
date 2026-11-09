import type { Campaign } from '@stagehand/shared';
import { PlusIcon } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';

import { CampaignNameDialog } from '@/components/campaigns/CampaignNameDialog';
import { CampaignRoleBadge } from '@/components/campaigns/CampaignRoleBadge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useCampaigns, useCreateCampaign, useSetCampaignArchived } from '@/lib/queries';

/** The signed-in user's campaigns: active ones first, archived ones folded away. */
export function CampaignList() {
  const { data: campaigns, isPending, isError } = useCampaigns();
  const createCampaign = useCreateCampaign();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);

  async function handleCreate(name: string) {
    const campaign = await createCampaign.mutateAsync(name);
    void navigate(`/campaigns/${campaign.id}`);
  }

  const active = campaigns?.filter((campaign) => campaign.archivedAt === null) ?? [];
  const archived = campaigns?.filter((campaign) => campaign.archivedAt !== null) ?? [];

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4">
        <CardTitle>
          <h2 className="text-xl">Your campaigns</h2>
        </CardTitle>
        <Button
          size="sm"
          onClick={() => {
            setCreating(true);
          }}
        >
          <PlusIcon aria-hidden />
          New campaign
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {isPending && <p className="text-muted-foreground">Loading campaigns…</p>}
        {isError && <p role="alert">Could not load your campaigns. Try again in a moment.</p>}
        {campaigns !== undefined && active.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No active campaigns yet. Start one with New campaign.
          </p>
        )}
        {active.length > 0 && (
          <ul className="divide-y rounded-md border" aria-label="Active campaigns">
            {active.map((campaign) => (
              <li key={campaign.id}>
                <Link
                  to={`/campaigns/${campaign.id}`}
                  className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-muted"
                >
                  <span className="font-medium">{campaign.name}</span>
                  <CampaignRoleBadge role={campaign.role} />
                </Link>
              </li>
            ))}
          </ul>
        )}
        {archived.length > 0 && <ArchivedCampaigns campaigns={archived} />}
      </CardContent>

      <CampaignNameDialog
        open={creating}
        onOpenChange={setCreating}
        title="New campaign"
        description="You'll be its GM. You can rename it later."
        submitLabel="Create campaign"
        onSave={handleCreate}
      />
    </Card>
  );
}

function ArchivedCampaigns({ campaigns }: { campaigns: Campaign[] }) {
  const setArchived = useSetCampaignArchived();

  return (
    <details className="group">
      <summary className="cursor-pointer text-sm font-medium text-muted-foreground">
        Archived ({campaigns.length})
      </summary>
      <ul className="mt-2 divide-y rounded-md border" aria-label="Archived campaigns">
        {campaigns.map((campaign) => (
          <li key={campaign.id} className="flex items-center justify-between gap-4 px-4 py-2">
            <Link
              to={`/campaigns/${campaign.id}`}
              className="text-muted-foreground hover:underline"
            >
              {campaign.name}
            </Link>
            {campaign.role === 'gm' && (
              <Button
                size="sm"
                variant="outline"
                disabled={setArchived.isPending}
                onClick={() => {
                  setArchived.mutate({ id: campaign.id, archived: false });
                }}
                aria-label={`Unarchive ${campaign.name}`}
              >
                Unarchive
              </Button>
            )}
          </li>
        ))}
      </ul>
      {setArchived.isError && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {setArchived.error.message}
        </p>
      )}
    </details>
  );
}
