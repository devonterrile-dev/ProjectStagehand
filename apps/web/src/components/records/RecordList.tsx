import { RECORD_TYPE_LABELS, type RecordSummary, type RecordType } from '@stagehand/shared';
import { Link } from 'react-router';

import { Badge } from '@/components/ui/badge';
import { pluralLabel, recordPath } from '@/lib/records';

interface RecordListProps {
  campaignId: string;
  records: RecordSummary[];
  /** The type being shown, or null for all (then each row shows its type). */
  type: RecordType | null;
}

export function RecordList({ campaignId, records, type }: RecordListProps) {
  if (records.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        {type === null
          ? 'No records yet. Start with New record.'
          : `No ${pluralLabel(type)} yet. Create one with New record.`}
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
            <span className="font-medium">{record.name}</span>
            {type === null && <Badge variant="secondary">{RECORD_TYPE_LABELS[record.type]}</Badge>}
            {record.parentName !== null && (
              <span className="text-sm text-muted-foreground">in {record.parentName}</span>
            )}
            {record.tags.map((tag) => (
              <Badge key={tag} variant="outline">
                {tag}
              </Badge>
            ))}
          </Link>
        </li>
      ))}
    </ul>
  );
}
