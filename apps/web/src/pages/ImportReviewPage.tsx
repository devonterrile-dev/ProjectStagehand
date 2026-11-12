import { Link, useParams } from 'react-router';

import {
  FailedImport,
  ImportReview,
  QuestionsStep,
  RunningImport,
} from '@/components/ai-import/ImportReview';
import { ImportStatusBadge } from '@/components/ai-import/ImportList';
import { PlayersNote } from '@/components/records/PlayersNote';
import { RecordNavigationProvider } from '@/components/records/RecordNavigationProvider';
import { formatWhen, IMPORT_MODE_LABELS, importPath } from '@/lib/ai-import';
import { useCampaign, useImport, useRecords } from '@/lib/queries';
import { CampaignNotFound } from '@/pages/CampaignPage';

/**
 * `/campaigns/:campaignId/imports/:importId` (F1.8b): waits for a running import (polling,
 * so it survives a reload), then shows its proposals for review, or why it failed.
 */
export function ImportReviewPage() {
  const { campaignId = '', importId = '' } = useParams();
  const campaignQuery = useCampaign(campaignId);
  const isGm = campaignQuery.data?.role === 'gm';
  const importQuery = useImport(campaignId, importId, isGm);
  const records = useRecords(campaignId, undefined, isGm);

  if (campaignQuery.isPending) return <p className="text-muted-foreground">Loading…</p>;
  if (campaignQuery.isError) {
    return <p role="alert">Could not load this campaign. Try again in a moment.</p>;
  }
  const campaign = campaignQuery.data;
  if (campaign === null) return <CampaignNotFound />;

  const backLink = (
    <Link to={importPath(campaign.id)} className="text-sm text-muted-foreground hover:underline">
      ← AI import
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
  if (importQuery.isPending || records.isPending) {
    return <p className="text-muted-foreground">Loading import…</p>;
  }
  if (importQuery.isError || records.isError) {
    return <p role="alert">Could not load this import. Try again in a moment.</p>;
  }
  const detail = importQuery.data;
  if (detail === null) {
    return (
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">Import not found</h1>
        <Link to={importPath(campaign.id)} className="underline">
          Back to AI import
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {backLink}
      <div className="space-y-1">
        <h1 className="flex flex-wrap items-center gap-3 text-2xl font-bold">
          {IMPORT_MODE_LABELS[detail.mode]}
          <ImportStatusBadge status={detail.status} />
        </h1>
        <p className="text-sm text-muted-foreground">
          {campaign.name} · started {formatWhen(detail.createdAt)}
        </p>
      </div>
      {detail.status === 'running' && <RunningImport detail={detail} />}
      {detail.status === 'questions' && <QuestionsStep campaign={campaign} detail={detail} />}
      {(detail.status === 'failed' || (detail.status === 'discarded' && detail.error !== null)) && (
        <FailedImport detail={detail} />
      )}
      {(detail.status === 'ready' ||
        detail.status === 'committed' ||
        (detail.status === 'discarded' && detail.error === null)) && (
        <RecordNavigationProvider campaignId={campaign.id}>
          <ImportReview campaign={campaign} detail={detail} records={records.data} />
        </RecordNavigationProvider>
      )}
    </div>
  );
}
