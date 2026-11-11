import { linkTargetsLabel, type LinkFieldSpec, type RecordSummary } from '@stagehand/shared';

import { FieldError } from '@/components/FieldError';
import { Label } from '@/components/ui/label';

import { RecordChip } from './RecordChip';
import { RecordPicker } from './RecordPicker';

/** A linked record as the form shows it: its id and current name. */
export interface LinkedRecord {
  id: string;
  name: string;
}

interface LinkFieldInputProps {
  id: string;
  spec: LinkFieldSpec;
  value: readonly LinkedRecord[];
  /** Every record of the campaign; filtered here to the field's types. */
  records: readonly RecordSummary[];
  /** The record being edited, which can't link to itself. */
  selfId: string;
  disabled: boolean;
  error: string | null;
  onChange: (next: LinkedRecord[]) => void;
}

/**
 * One §8 link field (D-24): chips for what's linked, and a search box offering only the
 * types the field accepts. A `one` field holds a single record, so its box shows only
 * while it's empty.
 */
export function LinkFieldInput({
  id,
  spec,
  value,
  records,
  selfId,
  disabled,
  error,
  onChange,
}: LinkFieldInputProps) {
  const targets = linkTargetsLabel(spec.targets);
  const linked = new Set(value.map((record) => record.id));
  const ofType = records.filter((record) => spec.targets.includes(record.type));
  const candidates = ofType.filter((record) => record.id !== selfId && !linked.has(record.id));
  const full = spec.cardinality === 'one' && value.length > 0;

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{spec.label}</Label>
      {value.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label={spec.label}>
          {value.map((record) => (
            <li key={record.id}>
              <RecordChip
                recordId={record.id}
                name={record.name}
                removeLabel={`Remove ${record.name} from ${spec.label}`}
                disabled={disabled}
                onRemove={() => {
                  onChange(value.filter((other) => other.id !== record.id));
                }}
              />
            </li>
          ))}
        </ul>
      )}
      {!full && !disabled && (
        <RecordPicker
          id={id}
          label={spec.label}
          placeholder={`Search ${targets}…`}
          candidates={candidates}
          onPick={(record) => {
            onChange([...value, { id: record.id, name: record.name }]);
          }}
        />
      )}
      {!full && !disabled && ofType.filter((record) => record.id !== selfId).length === 0 && (
        <p className="text-xs text-muted-foreground">No {targets} yet.</p>
      )}
      {disabled && value.length === 0 && <p className="text-sm text-muted-foreground">None</p>}
      <FieldError message={error} />
    </div>
  );
}
