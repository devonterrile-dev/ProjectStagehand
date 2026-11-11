import { RECORD_TYPE_LABELS, type RecordSummary } from '@stagehand/shared';
import { cn } from 'cn';
import type { CSSProperties } from 'react';

import { optionId } from '@/lib/records';

interface RecordOptionListProps {
  /** The listbox's id; option ids are derived from it (see `optionId`). */
  id: string;
  label: string;
  options: readonly RecordSummary[];
  /** The highlighted option, or -1. */
  active: number;
  onPick: (record: RecordSummary) => void;
  onActivate: (index: number) => void;
  className?: string;
  style?: CSSProperties;
}

/**
 * Records to choose from: name, type and (for Spots) the Area. Shared by the link pickers
 * and the @-mention menu. Options act on mouse down, so the input keeps focus.
 */
export function RecordOptionList({
  id,
  label,
  options,
  active,
  onPick,
  onActivate,
  className,
  style,
}: RecordOptionListProps) {
  return (
    <ul
      id={id}
      role="listbox"
      aria-label={label}
      style={style}
      className={cn(
        'z-50 max-h-64 overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md',
        className,
      )}
    >
      {options.map((record, index) => (
        <li
          key={record.id}
          id={optionId(id, index)}
          role="option"
          aria-selected={index === active}
          className={cn(
            'flex cursor-pointer items-center justify-between gap-3 rounded-sm px-2 py-1.5 text-sm',
            index === active && 'bg-accent text-accent-foreground',
          )}
          onMouseDown={(event) => {
            event.preventDefault();
            onPick(record);
          }}
          onMouseEnter={() => {
            onActivate(index);
          }}
        >
          <span className="truncate">
            {record.name}
            {record.parentName !== null && (
              <span className="text-muted-foreground"> · {record.parentName}</span>
            )}
          </span>
          <span className="shrink-0 text-xs text-muted-foreground">
            {RECORD_TYPE_LABELS[record.type]}
          </span>
        </li>
      ))}
    </ul>
  );
}
