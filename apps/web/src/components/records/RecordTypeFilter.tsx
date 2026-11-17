import { RECORD_TYPE_LABELS, RECORD_TYPES, type RecordType } from '@stagehand/shared';

import { Button } from '@/components/ui/button';

interface RecordTypeFilterProps {
  /** The chosen type, or null for all. */
  value: RecordType | null;
  counts: Record<RecordType, number>;
  total: number;
  onChange: (type: RecordType | null) => void;
  /**
   * A "Player entries" chip in front of the rest (F3.5); while it is chosen, no type chip
   * is.
   */
  entries?: { count: number; selected: boolean; onSelect: () => void };
  /** Leave out the types with nothing in them (the player journal). */
  hideEmpty?: boolean;
}

/** "All (12)", "NPC (3)", …: one chip per record type. */
export function RecordTypeFilter({
  value,
  counts,
  total,
  onChange,
  entries,
  hideEmpty = false,
}: RecordTypeFilterProps) {
  const typeChosen = entries?.selected !== true;
  const chip = (
    label: string,
    count: number,
    pressed: boolean,
    onClick: () => void,
    key: string,
  ) => (
    <Button
      key={key}
      type="button"
      size="sm"
      variant={pressed ? 'default' : 'outline'}
      aria-pressed={pressed}
      onClick={onClick}
    >
      {label} ({count})
    </Button>
  );
  const typeChip = (label: string, count: number, type: RecordType | null) =>
    chip(
      label,
      count,
      typeChosen && value === type,
      () => {
        onChange(type);
      },
      type ?? 'all',
    );

  return (
    <div role="group" aria-label="Record types" className="flex flex-wrap gap-2">
      {entries !== undefined &&
        chip('Player entries', entries.count, entries.selected, entries.onSelect, 'entries')}
      {typeChip('All', total, null)}
      {RECORD_TYPES.filter((type) => !hideEmpty || counts[type] > 0).map((type) =>
        typeChip(RECORD_TYPE_LABELS[type], counts[type], type),
      )}
    </div>
  );
}
