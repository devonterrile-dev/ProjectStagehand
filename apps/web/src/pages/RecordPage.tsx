import { RECORD_TYPE_LABELS } from '@stagehand/shared';
import { Link, useNavigate, useParams } from 'react-router';

import { PlayersNote } from '@/components/records/PlayersNote';
import { RecordForm } from '@/components/records/RecordForm';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { useCampaign, useRecord, useRecords } from '@/lib/queries';
import { recordsPath } from '@/lib/records';
import { CampaignNotFound } from '@/pages/CampaignPage';

/** `/campaigns/:campaignId/records/:recordId`: one record, autosaving as the GM edits. */
export function RecordPage() {
  const { campaignId = '', recordId = '' } = useParams();
  const campaignQuery = useCampaign(campaignId);
  const isGm = campaignQuery.data?.role === 'gm';
  const recordQuery = useRecord(campaignId, recordId, isGm);
  const { data: records } = useRecords(campaignId, undefined, isGm);
  const navigate = useNavigate();

  if (campaignQuery.isPending) return <p className="text-muted-foreground">Loading…</p>;
  if (campaignQuery.isError) {
    return <p role="alert">Could not load this campaign. Try again in a moment.</p>;
  }
  const campaign = campaignQuery.data;
  if (campaign === null) return <CampaignNotFound />;

  const backLink = (
    <Link to={recordsPath(campaign.id)} className="text-sm text-muted-foreground hover:underline">
      ← Records
    </Link>
  );

  if (!isGm) {
    return (
      <div className="space-y-4">
        {backLink}
        <PlayersNote />
      </div>
    );
  }
  if (recordQuery.isPending) return <p className="text-muted-foreground">Loading record…</p>;
  if (recordQuery.isError) {
    return <p role="alert">Could not load this record. Try again in a moment.</p>;
  }
  const record = recordQuery.data;
  if (record === null) {
    return (
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">Record not found</h1>
        <p className="text-muted-foreground">It may have been deleted.</p>
        <Link to={recordsPath(campaign.id)} className="underline">
          Back to records
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        {backLink}
        <Badge variant="secondary">{RECORD_TYPE_LABELS[record.type]}</Badge>
      </div>

      {campaign.archivedAt !== null && (
        <div className="rounded-md border bg-muted px-4 py-3 text-sm">
          This campaign is archived, so its records are read-only.
        </div>
      )}

      <Card>
        <CardContent className="pt-6">
          <RecordForm
            key={record.id}
            campaign={campaign}
            record={record}
            records={records ?? []}
            onDeleted={() => {
              void navigate(recordsPath(campaign.id, record.type), { replace: true });
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
