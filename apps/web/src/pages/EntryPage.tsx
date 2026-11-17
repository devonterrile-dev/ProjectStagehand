import { wasEdited, type Campaign } from '@stagehand/shared';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';

import { ConfirmDialog } from '@/components/ConfirmDialog';
import { EntryForm } from '@/components/journal/EntryForm';
import { NotesSection } from '@/components/journal/NotesSection';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { entriesPath, postedTime } from '@/lib/journal';
import { useCampaign, useDeleteEntry, useEntry, useMe, useUpdateEntry } from '@/lib/queries';
import { CampaignNotFound } from '@/pages/CampaignPage';

/**
 * `/campaigns/:campaignId/entries/:entryId`: a player entry (F3.5): its title, description and
 * author, then the table's notes. Its author can edit or delete it; the GM can delete it.
 */
export function EntryPage() {
  const { campaignId = '', entryId = '' } = useParams();
  const campaignQuery = useCampaign(campaignId);

  if (campaignQuery.isPending) return <p className="text-muted-foreground">Loading…</p>;
  if (campaignQuery.isError) {
    return <p role="alert">Could not load this campaign. Try again in a moment.</p>;
  }
  const campaign = campaignQuery.data;
  if (campaign === null) return <CampaignNotFound />;
  return <EntryView key={entryId} campaign={campaign} entryId={entryId} />;
}

function EntryView({ campaign, entryId }: { campaign: Campaign; entryId: string }) {
  const query = useEntry(campaign.id, entryId);
  const { data: me } = useMe();
  const update = useUpdateEntry(campaign.id, entryId);
  const remove = useDeleteEntry(campaign.id);
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const isGm = campaign.role === 'gm';
  const readOnly = campaign.archivedAt !== null;
  const backLink = (
    <Link to={entriesPath(campaign.id)} className="text-sm text-muted-foreground hover:underline">
      ← Player entries
    </Link>
  );

  if (query.isPending) return <p className="text-muted-foreground">Loading entry…</p>;
  if (query.isError) return <p role="alert">Could not load this entry. Try again in a moment.</p>;
  const entry = query.data;
  if (entry === null) {
    return (
      <div className="space-y-2">
        {backLink}
        <h1 className="text-2xl font-bold">Entry not found</h1>
        <p className="text-muted-foreground">It may have been deleted.</p>
      </div>
    );
  }
  const mine = entry.author.userId !== null && entry.author.userId === me?.id;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        {backLink}
        <div className="flex items-center gap-2">
          {!readOnly && mine && !editing && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                update.reset();
                setEditing(true);
              }}
            >
              Edit
            </Button>
          )}
          {!readOnly && (mine || isGm) && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setConfirming(true);
              }}
            >
              Delete
            </Button>
          )}
          <Badge variant="secondary">Player entry</Badge>
        </div>
      </div>

      <Card>
        <CardContent className="space-y-6 pt-6">
          {editing ? (
            <EntryForm
              initial={{ title: entry.title, description: entry.description }}
              submitLabel="Save"
              busy={update.isPending}
              error={update.isError ? update.error.message : null}
              onSubmit={(patch) => {
                update.mutate(patch, {
                  onSuccess: () => {
                    setEditing(false);
                  },
                });
              }}
              onCancel={() => {
                setEditing(false);
              }}
            />
          ) : (
            <div className="space-y-2">
              <h1 className="text-2xl font-bold">{entry.title}</h1>
              <p className="text-sm text-muted-foreground">
                {entry.author.displayName} ·{' '}
                <time dateTime={entry.createdAt}>{postedTime(entry.createdAt)}</time>
                {wasEdited(entry) && ' · edited'}
              </p>
              {entry.description !== '' && (
                <p className="whitespace-pre-wrap">{entry.description}</p>
              )}
            </div>
          )}
          <hr />
          <NotesSection
            campaignId={campaign.id}
            subject={{ entryId: entry.id }}
            isGm={isGm}
            readOnly={readOnly}
          />
        </CardContent>
      </Card>

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Delete this entry?"
        description={`“${entry.title}” and its notes will be gone for everyone in the campaign.`}
        confirmLabel="Delete entry"
        onConfirm={async () => {
          await remove.mutateAsync(entry.id);
          void navigate(entriesPath(campaign.id), { replace: true });
        }}
      />
    </div>
  );
}
