import { RECORD_TYPE_LABELS } from '@stagehand/shared';
import { SparklesIcon } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router';

import { BacklinksPanel } from '@/components/records/BacklinksPanel';
import { PlayersNote } from '@/components/records/PlayersNote';
import { RecordForm } from '@/components/records/RecordForm';
import { RecordNavigationProvider } from '@/components/records/RecordNavigationProvider';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { importPath } from '@/lib/ai-import';
import { useCampaign, useRecord, useRecords } from '@/lib/queries';
import { useRememberRecent } from '@/lib/recent-items';
import { recordsPath } from '@/lib/records';
import { CampaignNotFound } from '@/pages/CampaignPage';

/**
 * `/campaigns/:campaignId/records/:recordId`: one record, autosaving as the GM edits, with
 * its backlinks in a side column (stacked below on narrow screens). The app shell widens
 * this page (`AppShell`).
 */
export function RecordPage() {
  const { campaignId = '', recordId = '' } = useParams();
  const campaignQuery = useCampaign(campaignId);
  const isGm = campaignQuery.data?.role === 'gm';
  const recordQuery = useRecord(campaignId, recordId, isGm);
  const { data: records } = useRecords(campaignId, undefined, isGm);
  const navigate = useNavigate();
  const loaded = recordQuery.data ?? null;
  useRememberRecent(campaignId, loaded === null ? null : { kind: 'record', id: loaded.id });

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
        <div className="flex items-center gap-2">
          {campaign.archivedAt === null && (
            <Button asChild size="sm" variant="outline">
              <Link to={importPath(campaign.id, { mode: 'fill', record: record.id })}>
                <SparklesIcon aria-hidden />
                Fill in with AI
              </Link>
            </Button>
          )}
          <Badge variant="secondary">{RECORD_TYPE_LABELS[record.type]}</Badge>
        </div>
      </div>

      {campaign.archivedAt !== null && (
        <div className="rounded-md border bg-muted px-4 py-3 text-sm">
          This campaign is archived, so its records are read-only.
        </div>
      )}

      <RecordNavigationProvider campaignId={campaign.id}>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-start">
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
          <aside className="lg:sticky lg:top-6">
            <BacklinksPanel
              key={record.id}
              campaignId={campaign.id}
              recordId={record.id}
              recordType={record.type}
            />
          </aside>
        </div>
      </RecordNavigationProvider>
    </div>
  );
}
