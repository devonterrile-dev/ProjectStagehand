import { LINK_LABEL_MAX, type RecordSummary } from '@stagehand/shared';
import { XIcon } from 'lucide-react';

import { FieldError } from '@/components/FieldError';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

import { RecordOpenMenu } from './RecordOpenMenu';
import { RecordPicker } from './RecordPicker';

/** One extra link as the form edits it; an empty label is sent as null. */
export interface OtherLinkRow {
  id: string;
  name: string;
  label: string;
}

interface OtherLinksEditorProps {
  value: readonly OtherLinkRow[];
  records: readonly RecordSummary[];
  selfId: string;
  disabled: boolean;
  error: string | null;
  /** The whole list; `now` for adds and removes, debounced while a label is typed. */
  onChange: (next: OtherLinkRow[], now: boolean) => void;
  onBlur: () => void;
}

/**
 * Links that don't fit a §8 field (D-24): any record, with an optional relationship such
 * as "rival of". The whole list is saved each time.
 */
export function OtherLinksEditor({
  value,
  records,
  selfId,
  disabled,
  error,
  onChange,
  onBlur,
}: OtherLinksEditorProps) {
  const linked = new Set(value.map((row) => row.id));
  const candidates = records.filter((record) => record.id !== selfId && !linked.has(record.id));

  return (
    <div className="space-y-2">
      <Label htmlFor="record-other-links">Other links</Label>
      <p className="text-xs text-muted-foreground">
        Anything else this record is tied to, with an optional relationship.
      </p>
      {value.length > 0 && (
        <ul className="space-y-2" aria-label="Other links">
          {value.map((row, index) => (
            <li key={row.id} className="flex items-center gap-2">
              <RecordOpenMenu recordId={row.id} name={row.name}>
                <button
                  type="button"
                  className="w-40 shrink-0 truncate text-left text-sm font-medium hover:underline"
                >
                  {row.name}
                </button>
              </RecordOpenMenu>
              <Input
                aria-label={`Relationship to ${row.name}`}
                placeholder="Relationship, e.g. rival of"
                value={row.label}
                maxLength={LINK_LABEL_MAX}
                disabled={disabled}
                onChange={(event) => {
                  const next = value.map((other, i) =>
                    i === index ? { ...other, label: event.target.value } : other,
                  );
                  onChange(next, false);
                }}
                onBlur={onBlur}
              />
              {!disabled && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove the link to ${row.name}`}
                  onClick={() => {
                    onChange(
                      value.filter((other) => other.id !== row.id),
                      true,
                    );
                  }}
                >
                  <XIcon aria-hidden />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {!disabled && (
        <RecordPicker
          id="record-other-links"
          label="Add a link"
          placeholder="Add a link…"
          candidates={candidates}
          onPick={(record) => {
            onChange([...value, { id: record.id, name: record.name, label: '' }], true);
          }}
        />
      )}
      {disabled && value.length === 0 && <p className="text-sm text-muted-foreground">None</p>}
      <FieldError message={error} />
    </div>
  );
}
