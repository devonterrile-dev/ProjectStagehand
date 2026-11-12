import type { ImportStatus, ImportSummary } from '@stagehand/shared';
import { Link } from 'react-router';

import { Badge } from '@/components/ui/badge';
import {
  formatTokens,
  formatUsd,
  formatWhen,
  IMPORT_MODE_LABELS,
  IMPORT_STATUS_LABELS,
  importReviewPath,
  proposalCountsLabel,
  totalTokens,
} from '@/lib/ai-import';

const STATUS_VARIANT: Record<ImportStatus, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  running: 'outline',
  questions: 'default',
  ready: 'default',
  failed: 'destructive',
  committed: 'secondary',
  discarded: 'outline',
};

export function ImportStatusBadge({ status }: { status: ImportStatus }) {
  return <Badge variant={STATUS_VARIANT[status]}>{IMPORT_STATUS_LABELS[status]}</Badge>;
}

/** The campaign's past imports, newest first, each with what it cost. */
export function ImportList({ imports }: { imports: ImportSummary[] }) {
  if (imports.length === 0) {
    return <p className="text-sm text-muted-foreground">No imports in this campaign yet.</p>;
  }
  return (
    <ul className="divide-y">
      {imports.map((summary) => (
        <li key={summary.id} className="space-y-1 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              to={importReviewPath(summary.campaignId, summary.id)}
              className="font-medium hover:underline"
            >
              {formatWhen(summary.createdAt)} · {IMPORT_MODE_LABELS[summary.mode]}
            </Link>
            <ImportStatusBadge status={summary.status} />
          </div>
          {summary.textPreview !== '' && (
            <p className="line-clamp-2 text-sm text-muted-foreground">{summary.textPreview}</p>
          )}
          <p className="text-xs text-muted-foreground">
            {summary.status === 'running' ||
            summary.status === 'questions' ||
            summary.status === 'failed'
              ? ''
              : `${proposalCountsLabel(summary.proposalCounts)} · `}
            {formatTokens(totalTokens(summary.usage))} tokens ·{' '}
            {formatUsd(summary.estimatedCostUsd)}
          </p>
        </li>
      ))}
    </ul>
  );
}
