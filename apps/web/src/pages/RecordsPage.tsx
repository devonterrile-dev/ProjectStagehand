import { RECORD_TYPES, type Campaign, type RecordType } from '@stagehand/shared';
import { PlusIcon } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';

import { NewRecordDialog } from '@/components/records/NewRecordDialog';
import { PlayersNote } from '@/components/records/PlayersNote';
import { RecordList } from '@/components/records/RecordList';
import { RecordTypeFilter } from '@/components/records/RecordTypeFilter';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useCampaign, useRecords } from '@/lib/queries';
import { parseTypeParam, recordPath } from '@/lib/records';
import { CampaignNotFound } from '@/pages/CampaignPage';

/** `/campaigns/:campaignId/records`: the GM's records, one type at a time. */
export function RecordsPage() {
  const { campaignId = '' } = useParams();
  const { data: campaign, isPending, isError } = useCampaign(campaignId);

  if (isPending) return <p className="text-muted-foreground">Loading…</p>;
  if (isError) return <p role="alert">Could not load this campaign. Try again in a moment.</p>;
  if (campaign === null) return <CampaignNotFound />;
  return <RecordsView campaign={campaign} />;
}

function RecordsView({ campaign }: { campaign: Campaign }) {
  const isGm = campaign.role === 'gm';
  const isArchived = campaign.archivedAt !== null;
  const [searchParams, setSearchParams] = useSearchParams();
  const type = parseTypeParam(searchParams.get('type'));
  const { data: records, isPending, isError } = useRecords(campaign.id, undefined, isGm);
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);

  const counts = Object.fromEntries(RECORD_TYPES.map((t) => [t, 0])) as Record<RecordType, number>;
  for (const record of records ?? []) counts[record.type] += 1;
  const shown = (records ?? []).filter((record) => type === null || record.type === type);

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
            <h1 className="text-2xl">Records</h1>
          </CardTitle>
          {isGm && !isArchived && (
            <Button
              size="sm"
              onClick={() => {
                setCreating(true);
              }}
            >
              <PlusIcon aria-hidden />
              New record
            </Button>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          {!isGm && <PlayersNote />}
          {isGm && (
            <RecordTypeFilter
              value={type}
              counts={counts}
              total={records?.length ?? 0}
              onChange={(next) => {
                setSearchParams(next === null ? {} : { type: next });
              }}
            />
          )}
          {isGm && isPending && <p className="text-muted-foreground">Loading records…</p>}
          {isGm && isError && (
            <p role="alert">Could not load the records. Try again in a moment.</p>
          )}
          {isGm && records !== undefined && (
            <RecordList campaignId={campaign.id} records={shown} type={type} />
          )}
        </CardContent>
      </Card>

      {creating && records !== undefined && (
        <NewRecordDialog
          campaignId={campaign.id}
          initialType={type ?? 'npc'}
          records={records}
          open
          onOpenChange={(open) => {
            if (!open) setCreating(false);
          }}
          onCreated={(record) => {
            void navigate(recordPath(campaign.id, record.id));
          }}
        />
      )}
    </div>
  );
}
