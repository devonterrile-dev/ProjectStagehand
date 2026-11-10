import { RECORD_TYPE_LABELS, RECORD_TYPES, type RecordType } from '@stagehand/shared';

import { Button } from '@/components/ui/button';

interface RecordTypeFilterProps {
  /** The chosen type, or null for all. */
  value: RecordType | null;
  counts: Record<RecordType, number>;
  total: number;
  onChange: (type: RecordType | null) => void;
}

/** "All (12)", "NPC (3)", …: one chip per record type. */
export function RecordTypeFilter({ value, counts, total, onChange }: RecordTypeFilterProps) {
  const chip = (label: string, count: number, type: RecordType | null) => (
    <Button
      key={type ?? 'all'}
      type="button"
      size="sm"
      variant={value === type ? 'default' : 'outline'}
      aria-pressed={value === type}
      onClick={() => {
        onChange(type);
      }}
    >
      {label} ({count})
    </Button>
  );

  return (
    <div role="group" aria-label="Record types" className="flex flex-wrap gap-2">
      {chip('All', total, null)}
      {RECORD_TYPES.map((type) => chip(RECORD_TYPE_LABELS[type], counts[type], type))}
    </div>
  );
}
