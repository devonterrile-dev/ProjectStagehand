import {
  RECORD_TYPE_LABELS,
  type JournalRecordSummary,
  type PlayerEntry,
  type RecordType,
} from '@stagehand/shared';
import { Link } from 'react-router';

import { Highlight } from '@/components/search/Highlight';
import { Badge } from '@/components/ui/badge';
import { entryPath, postedTime } from '@/lib/journal';
import { pluralLabel, recordPath } from '@/lib/records';

/** Revealed records in a list, like the GM's but with no tags (F3.5). */
export function JournalRecordList({
  campaignId,
  records,
  type,
  terms,
  searching,
}: {
  campaignId: string;
  records: readonly JournalRecordSummary[];
  /** The type being shown, or null for all (then each row shows its type). */
  type: RecordType | null;
  terms: readonly string[];
  searching: boolean;
}) {
  if (records.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        {searching
          ? 'Nothing in the journal matches.'
          : type === null
            ? 'Nothing has been revealed yet. Records your GM shows you appear here.'
            : `No ${pluralLabel(type)} revealed yet.`}
      </p>
    );
  }
  return (
    <ul className="divide-y rounded-md border" aria-label="Records">
      {records.map((record) => (
        <li key={record.id}>
          <Link
            to={recordPath(campaignId, record.id)}
            className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 hover:bg-muted"
          >
            <span className="font-medium">
              <Highlight text={record.name} terms={terms} />
            </span>
            {type === null && <Badge variant="secondary">{RECORD_TYPE_LABELS[record.type]}</Badge>}
            {record.parentName !== null && (
              <span className="text-sm text-muted-foreground">in {record.parentName}</span>
            )}
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** The players' entries, newest first, with who wrote each. */
export function EntryList({
  campaignId,
  entries,
  terms,
  searching,
}: {
  campaignId: string;
  entries: readonly PlayerEntry[];
  terms: readonly string[];
  searching: boolean;
}) {
  if (entries.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        {searching ? 'No entries match.' : 'No player entries yet.'}
      </p>
    );
  }
  return (
    <ul className="divide-y rounded-md border" aria-label="Player entries">
      {entries.map((entry) => (
        <li key={entry.id}>
          <Link
            to={entryPath(campaignId, entry.id)}
            className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 hover:bg-muted"
          >
            <span className="font-medium">
              <Highlight text={entry.title} terms={terms} />
            </span>
            <span className="text-sm text-muted-foreground">
              {entry.author.displayName} · {postedTime(entry.createdAt)}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
