import type { Campaign } from '@stagehand/shared';
import { ArchiveIcon, MoreHorizontalIcon, PencilIcon } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router';

import { CampaignNameDialog } from '@/components/campaigns/CampaignNameDialog';
import { CampaignRoleBadge } from '@/components/campaigns/CampaignRoleBadge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useCampaign, useRenameCampaign, useSetCampaignArchived } from '@/lib/queries';

/** `/campaigns/:campaignId`. Rendered inside RequireAuth, so the user is signed in. */
export function CampaignPage() {
  const { campaignId = '' } = useParams();
  const { data: campaign, isPending, isError } = useCampaign(campaignId);

  if (isPending) return <p className="text-muted-foreground">Loading…</p>;
  if (isError) return <p role="alert">Could not load this campaign. Try again in a moment.</p>;
  if (campaign === null) return <CampaignNotFound />;
  return <CampaignView campaign={campaign} />;
}

function CampaignView({ campaign }: { campaign: Campaign }) {
  const rename = useRenameCampaign();
  const setArchived = useSetCampaignArchived();
  const [renaming, setRenaming] = useState(false);

  const isGm = campaign.role === 'gm';
  const isArchived = campaign.archivedAt !== null;

  return (
    <div className="space-y-4">
      <Link to="/" className="text-sm text-muted-foreground hover:underline">
        ← All campaigns
      </Link>

      {isArchived && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted px-4 py-3 text-sm">
          <span>This campaign is archived, so it&apos;s read-only.</span>
          {isGm && (
            <Button
              size="sm"
              variant="outline"
              disabled={setArchived.isPending}
              onClick={() => {
                setArchived.mutate({ id: campaign.id, archived: false });
              }}
            >
              Unarchive
            </Button>
          )}
        </div>
      )}

      {setArchived.isError && (
        <p role="alert" className="text-sm text-destructive">
          {setArchived.error.message}
        </p>
      )}

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <CardTitle>
              <h1 className="text-2xl">{campaign.name}</h1>
            </CardTitle>
            <CampaignRoleBadge role={campaign.role} />
          </div>
          {isGm && (
            // Non-modal so the rename dialog it opens can take focus cleanly.
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="Campaign settings">
                  <MoreHorizontalIcon aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  disabled={isArchived}
                  onSelect={() => {
                    setRenaming(true);
                  }}
                >
                  <PencilIcon aria-hidden />
                  Rename…
                </DropdownMenuItem>
                {!isArchived && (
                  <DropdownMenuItem
                    disabled={setArchived.isPending}
                    onSelect={() => {
                      setArchived.mutate({ id: campaign.id, archived: true });
                    }}
                  >
                    <ArchiveIcon aria-hidden />
                    Archive
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Records, invites and sessions for this campaign will appear here.
          </p>
        </CardContent>
      </Card>

      <CampaignNameDialog
        open={renaming}
        onOpenChange={setRenaming}
        title="Rename campaign"
        description="Players will see the new name too."
        submitLabel="Save name"
        initialName={campaign.name}
        onSave={(name) => rename.mutateAsync({ id: campaign.id, name })}
      />
    </div>
  );
}

function CampaignNotFound() {
  return (
    <div className="space-y-2">
      <h1 className="text-2xl font-bold">Campaign not found</h1>
      <p className="text-muted-foreground">It may not exist, or you may not be a member of it.</p>
      <Link to="/" className="underline">
        Back to your campaigns
      </Link>
    </div>
  );
}
