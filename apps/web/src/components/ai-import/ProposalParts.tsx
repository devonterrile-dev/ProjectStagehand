import {
  isEmptyRichText,
  type PointOfInterest,
  type RichText,
  type ValueFieldSpec,
} from '@stagehand/shared';
import { XIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';

import { RichTextView } from '@/components/records/RichTextView';
import { Badge } from '@/components/ui/badge';
import { isBlank } from '@/lib/ai-import';
import { enumLabel, recordPath } from '@/lib/records';

import { useReview } from './review-context';

/**
 * A record a proposal points at. An existing record opens in a new tab (the review stays
 * put); a proposed one is marked "new" and has no page yet; a missing one was deleted.
 */
export function RefChip({
  id,
  suffix,
  onRemove,
}: {
  id: string;
  /** Shown after the name, e.g. a relationship. */
  suffix?: string | null;
  onRemove?: () => void;
}) {
  const { campaignId, refs } = useReview();
  const ref = refs[id];
  const name = ref?.name ?? 'Deleted record';
  return (
    <Badge variant="secondary" className="gap-1 pr-1">
      {ref === undefined || ref.proposed ? (
        <span className={ref === undefined ? 'line-through' : ''}>{name}</span>
      ) : (
        <Link
          to={recordPath(campaignId, id)}
          target="_blank"
          rel="noreferrer"
          className="hover:underline"
        >
          {name}
        </Link>
      )}
      {ref?.proposed === true && <span className="text-muted-foreground">· new</span>}
      {suffix !== undefined && suffix !== null && suffix !== '' && (
        <span className="text-muted-foreground">({suffix})</span>
      )}
      {onRemove !== undefined && (
        <button
          type="button"
          aria-label={`Remove ${name}`}
          className="rounded-sm p-0.5 hover:bg-muted"
          onClick={onRemove}
        >
          <XIcon className="size-3" aria-hidden />
        </button>
      )}
    </Badge>
  );
}

/** A field's value, read-only, by its kind. */
export function FieldValue({ spec, value }: { spec: ValueFieldSpec; value: unknown }) {
  if (isBlank(value)) return <span className="text-muted-foreground italic">Empty</span>;
  switch (spec.kind) {
    case 'rich':
      return <RichTextView value={value as RichText} />;
    case 'list':
      return (
        <ul className="list-disc space-y-1 pl-6">
          {(value as PointOfInterest[]).map((row, index) => (
            <li key={index}>
              <span className="font-medium">{row.name}</span>
              {row.detail !== '' && <>: {row.detail}</>}
            </li>
          ))}
        </ul>
      );
    case 'enum':
      return <span>{enumLabel(String(value))}</span>;
    default:
      return <span className="whitespace-pre-wrap">{String(value)}</span>;
  }
}

/** Rich text read-only, or "Empty". */
export function RichValue({ value }: { value: RichText }) {
  return isEmptyRichText(value) ? (
    <span className="text-muted-foreground italic">Empty</span>
  ) : (
    <RichTextView value={value} />
  );
}

/** One labelled part of a card. */
export function Part({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</p>
      <div className="text-sm">{children}</div>
    </div>
  );
}

/** Before → after for one changed key of an update. */
export function Diff({
  label,
  before,
  after,
  action,
}: {
  label: string;
  before: ReactNode;
  after: ReactNode;
  /** E.g. "Drop this change", while editing. */
  action?: ReactNode;
}) {
  return (
    <div className="space-y-2 rounded-md border p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">{label}</p>
        {action}
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">Now</p>
          <div className="text-sm">{before}</div>
        </div>
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">Proposed</p>
          <div className="text-sm">{after}</div>
        </div>
      </div>
    </div>
  );
}
