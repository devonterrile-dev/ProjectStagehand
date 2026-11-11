import { PlusIcon } from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';

interface ListEditorProps<T> {
  id: string;
  /** Names one row in labels, e.g. "Experience" → "Remove experience 2". */
  itemLabel: string;
  value: T[];
  /** A blank row for the Add button. */
  empty: () => T;
  /** Rows that aren't complete (no name yet) stay on screen but aren't saved. */
  isComplete: (row: T) => boolean;
  max: number;
  disabled: boolean;
  emptyText: string;
  /** The row's inputs. `set` replaces the row; `now` saves at once (a choice, not typing). */
  renderRow: (row: T, set: (next: T, now?: boolean) => void, index: number) => ReactNode;
  /** The complete rows; `now` asks for an immediate save (a row added or removed). */
  onChange: (rows: T[], now: boolean) => void;
}

/** Row keys only need to be unique on the page, so one counter serves every list. */
let nextRowKey = 0;
const keyed = <T,>(value: T): Row<T> => ({ key: nextRowKey++, value });

interface Row<T> {
  /** Stable while the page is open, so inputs with their own state follow their row. */
  key: number;
  value: T;
}

/**
 * A repeating list of rows (experiences, weapons, inventory, abilities, motives). Each
 * change hands back the whole list, since a sheet PATCH replaces lists whole (D-23).
 */
export function ListEditor<T>({
  id,
  itemLabel,
  value,
  empty,
  isComplete,
  max,
  disabled,
  emptyText,
  renderRow,
  onChange,
}: ListEditorProps<T>) {
  const [rows, setRows] = useState<Row<T>[]>(() => value.map((row) => keyed(row)));
  const lower = itemLabel.toLowerCase();

  function emit(next: Row<T>[], now: boolean) {
    setRows(next);
    onChange(next.map((row) => row.value).filter(isComplete), now);
  }

  return (
    <div id={id} className="space-y-3">
      {rows.length === 0 && <p className="text-sm text-muted-foreground">{emptyText}</p>}
      {rows.map((row, index) => (
        <div key={row.key} className="space-y-2 rounded-md border p-3">
          <div className="flex items-start gap-2">
            <div className="flex-1 space-y-2">
              {renderRow(
                row.value,
                (next, now = false) => {
                  emit(
                    rows.map((current) =>
                      current.key === row.key ? { key: row.key, value: next } : current,
                    ),
                    now,
                  );
                },
                index,
              )}
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={disabled}
              aria-label={`Remove ${lower} ${String(index + 1)}`}
              onClick={() => {
                emit(
                  rows.filter((current) => current.key !== row.key),
                  true,
                );
              }}
            >
              Remove
            </Button>
          </div>
          {!isComplete(row.value) && (
            <p className="text-xs text-muted-foreground">Give it a name to save it.</p>
          )}
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled || rows.length >= max}
        onClick={() => {
          emit([...rows, keyed(empty())], false);
        }}
      >
        <PlusIcon aria-hidden />
        Add {lower}
      </Button>
    </div>
  );
}
