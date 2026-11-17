import { RECORD_TYPE_LABELS, type Campaign } from '@stagehand/shared';
import { Link } from 'react-router';

import { RichTextView } from '@/components/records/RichTextView';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { useJournalRecord } from '@/lib/queries';
import { recordPath, recordsPath } from '@/lib/records';
import { stageImageUrl } from '@/lib/scenes';

import { NotesSection } from './NotesSection';

/**
 * A revealed record as a player reads it (F3.5, governance §7): its name, type, image and
 * public description, then the table's notes. A record players don't have is "not found".
 */
export function JournalRecordView({
  campaign,
  recordId,
}: {
  campaign: Campaign;
  recordId: string;
}) {
  const query = useJournalRecord(campaign.id, recordId);
  const backLink = (
    <Link to={recordsPath(campaign.id)} className="text-sm text-muted-foreground hover:underline">
      ← Records
    </Link>
  );

  if (query.isPending) return <p className="text-muted-foreground">Loading record…</p>;
  if (query.isError) {
    return <p role="alert">Could not load this record. Try again in a moment.</p>;
  }
  const record = query.data;
  if (record === null) {
    return (
      <div className="space-y-2">
        {backLink}
        <h1 className="text-2xl font-bold">Record not found</h1>
        <p className="text-muted-foreground">It may have been hidden or deleted by your GM.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        {backLink}
        <Badge variant="secondary">{RECORD_TYPE_LABELS[record.type]}</Badge>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-start">
        <Card>
          <CardContent className="space-y-6 pt-6">
            <div className="space-y-1">
              <h1 className="text-2xl font-bold">{record.name}</h1>
              {record.parentName !== null && (
                <p className="text-sm text-muted-foreground">in {record.parentName}</p>
              )}
            </div>
            <RichTextView
              value={record.publicDescription}
              mentionHref={(id) => recordPath(campaign.id, id)}
            />
            <hr />
            <NotesSection
              campaignId={campaign.id}
              subject={{ recordId: record.id }}
              isGm={campaign.role === 'gm'}
              readOnly={campaign.archivedAt !== null}
            />
          </CardContent>
        </Card>
        {record.image !== null && (
          <aside className="lg:sticky lg:top-6">
            <img
              src={stageImageUrl(campaign.id, record.image)}
              alt={record.name}
              width={record.image.width}
              height={record.image.height}
              className="mx-auto max-h-96 w-auto rounded-md"
            />
          </aside>
        )}
      </div>
    </div>
  );
}
