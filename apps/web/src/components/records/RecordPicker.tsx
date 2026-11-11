import type { RecordSummary } from '@stagehand/shared';
import { useId, useState, type KeyboardEvent } from 'react';

import { filterRecords, optionId } from '@/lib/records';

import { RecordOptionList } from './RecordOptionList';

/** How many matches the list shows at once. */
const SHOWN = 8;

interface RecordPickerProps {
  id?: string;
  /** The input's accessible name, e.g. "Add to Factions". */
  label: string;
  placeholder: string;
  /** The records that may be picked (already filtered by type, without the record itself). */
  candidates: readonly RecordSummary[];
  disabled?: boolean;
  onPick: (record: RecordSummary) => void;
}

/**
 * A type-to-search combobox over records (F1.5b). Focus or typing opens the list of
 * matches; arrow keys move, Enter picks, Esc or leaving the box closes it.
 */
export function RecordPicker({
  id,
  label,
  placeholder,
  candidates,
  disabled = false,
  onPick,
}: RecordPickerProps) {
  const listId = useId();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const matches = filterRecords(candidates, query, { limit: SHOWN });
  const showing = open && matches.length > 0;

  function pick(record: RecordSummary) {
    setQuery('');
    setActive(0);
    setOpen(false);
    onPick(record);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive((current) => (current + step + matches.length) % Math.max(matches.length, 1));
    } else if (event.key === 'Enter') {
      const record = showing ? matches[active] : undefined;
      if (record !== undefined) {
        event.preventDefault();
        pick(record);
      }
    } else if (event.key === 'Escape' && open) {
      event.preventDefault();
      setOpen(false);
    }
  }

  return (
    <div className="relative">
      <input
        id={id}
        role="combobox"
        aria-label={label}
        aria-expanded={showing}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showing ? optionId(listId, active) : undefined}
        autoComplete="off"
        className="h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50 dark:bg-input/30"
        placeholder={placeholder}
        value={query}
        disabled={disabled}
        onChange={(event) => {
          setQuery(event.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => {
          setOpen(true);
        }}
        onBlur={() => {
          setOpen(false);
        }}
        onKeyDown={handleKeyDown}
      />
      {showing && (
        <RecordOptionList
          id={listId}
          label={label}
          options={matches}
          active={active}
          onPick={pick}
          onActivate={setActive}
          className="absolute top-full right-0 left-0 mt-1"
        />
      )}
      {open && matches.length === 0 && query.trim() !== '' && (
        <p className="absolute top-full mt-1 rounded-md border bg-popover px-3 py-2 text-sm text-muted-foreground shadow-md">
          No matches
        </p>
      )}
    </div>
  );
}
