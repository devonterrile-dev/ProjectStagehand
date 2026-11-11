import { useState } from 'react';

import { FieldError } from '@/components/FieldError';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface NumberFieldProps {
  id: string;
  label: string;
  /** The stored value when the form opened; the input keeps its own text after that. */
  initial: number;
  min?: number;
  max?: number;
  /** Shown after the input, e.g. "of 6". */
  suffix?: string;
  disabled: boolean;
  error: string | null;
  /** A new value, or null when the text isn't a number (the form shows the error). */
  onCommit: (value: number | null) => void;
  onBlur: () => void;
}

/** A whole-number field of a sheet or stat block. */
export function NumberField({
  id,
  label,
  initial,
  min,
  max,
  suffix,
  disabled,
  error,
  onCommit,
  onBlur,
}: NumberFieldProps) {
  const [draft, setDraft] = useState(String(initial));

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-2">
        <Input
          id={id}
          type="number"
          inputMode="numeric"
          step={1}
          min={min}
          max={max}
          className="w-24"
          value={draft}
          disabled={disabled}
          aria-invalid={error !== null}
          onChange={(event) => {
            setDraft(event.target.value);
            const text = event.target.value.trim();
            onCommit(text === '' ? null : Number(text));
          }}
          onBlur={onBlur}
        />
        {suffix !== undefined && <span className="text-sm text-muted-foreground">{suffix}</span>}
      </div>
      <FieldError message={error} />
    </div>
  );
}
