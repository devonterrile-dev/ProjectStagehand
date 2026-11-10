import { POINTS_OF_INTEREST_MAX, TEXT_FIELD_MAX, type PointOfInterest } from '@stagehand/shared';
import { PlusIcon } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

interface PointsOfInterestEditorProps {
  id: string;
  value: PointOfInterest[];
  disabled: boolean;
  /** Rows with a name; `now` asks for an immediate save (adding or removing a row). */
  onChange: (next: PointOfInterest[], now: boolean) => void;
  onBlur: () => void;
}

/** A Spot's points of interest: the things players will be able to click on stage. */
export function PointsOfInterestEditor({
  id,
  value,
  disabled,
  onChange,
  onBlur,
}: PointsOfInterestEditorProps) {
  const [rows, setRows] = useState<PointOfInterest[]>(value);

  function emit(next: PointOfInterest[], now: boolean) {
    setRows(next);
    onChange(
      next.filter((row) => row.name.trim() !== ''),
      now,
    );
  }

  function update(index: number, patch: Partial<PointOfInterest>) {
    emit(
      rows.map((row, i) => (i === index ? { ...row, ...patch } : row)),
      false,
    );
  }

  return (
    <div id={id} className="space-y-3">
      {rows.length === 0 && (
        <p className="text-sm text-muted-foreground">Nothing for players to click on yet.</p>
      )}
      {rows.map((row, index) => (
        // Rows have no id of their own; their position is their identity here.
        <div key={index} className="space-y-2 rounded-md border p-3">
          <div className="flex items-center gap-2">
            <Input
              aria-label={`Point of interest ${String(index + 1)} name`}
              placeholder="Name"
              value={row.name}
              maxLength={120}
              disabled={disabled}
              onChange={(event) => {
                update(index, { name: event.target.value });
              }}
              onBlur={onBlur}
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={disabled}
              aria-label={`Remove point of interest ${String(index + 1)}`}
              onClick={() => {
                emit(
                  rows.filter((_, i) => i !== index),
                  true,
                );
              }}
            >
              Remove
            </Button>
          </div>
          <Textarea
            aria-label={`Point of interest ${String(index + 1)} detail`}
            placeholder="What players learn when they click it"
            value={row.detail}
            maxLength={TEXT_FIELD_MAX}
            disabled={disabled}
            onChange={(event) => {
              update(index, { detail: event.target.value });
            }}
            onBlur={onBlur}
          />
          {row.name.trim() === '' && (
            <p className="text-xs text-muted-foreground">Give it a name to save it.</p>
          )}
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled || rows.length >= POINTS_OF_INTEREST_MAX}
        onClick={() => {
          emit([...rows, { name: '', detail: '' }], false);
        }}
      >
        <PlusIcon aria-hidden />
        Add point of interest
      </Button>
    </div>
  );
}
