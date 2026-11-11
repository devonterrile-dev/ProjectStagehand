import {
  RECORD_TYPE_LABELS,
  type RecordMatch,
  type RecordSummary,
  type RecordType,
} from '@stagehand/shared';
import { Link } from 'react-router';

import { Highlight } from '@/components/search/Highlight';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { MATCH_FIELD_LABELS, pluralLabel, recordPath } from '@/lib/records';

interface RecordListProps {
  campaignId: string;
  records: (RecordSummary & { match?: RecordMatch | null })[];
  /** The type being shown, or null for all (then each row shows its type). */
  type: RecordType | null;
  /** The search terms, to bold in names and excerpts. */
  terms?: readonly string[];
  /** Set while a search, tag or Area narrows the list: the empty state offers to clear it. */
  onClearFilters?: () => void;
}

export function RecordList({
  campaignId,
  records,
  type,
  terms = [],
  onClearFilters,
}: RecordListProps) {
  if (records.length === 0) {
    if (onClearFilters !== undefined) {
      return (
        <p className="text-sm text-muted-foreground">
          No records match.{' '}
          <Button
            type="button"
            variant="link"
            className="h-auto p-0 text-sm"
            onClick={onClearFilters}
          >
            Clear filters
          </Button>
        </p>
      );
    }
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
            <span className="font-medium">
              <Highlight text={record.name} terms={terms} />
            </span>
            {type === null && <Badge variant="secondary">{RECORD_TYPE_LABELS[record.type]}</Badge>}
            {record.parentName !== null && (
              <span className="text-sm text-muted-foreground">in {record.parentName}</span>
            )}
            {record.tags.map((tag) => (
              <Badge key={tag} variant="outline">
                {tag}
              </Badge>
            ))}
            {record.match !== undefined && record.match !== null && (
              <span className="w-full text-sm text-muted-foreground">
                {MATCH_FIELD_LABELS[record.match.field]}:{' '}
                <Highlight text={record.match.snippet} terms={terms} />
              </span>
            )}
          </Link>
        </li>
      ))}
    </ul>
  );
}
