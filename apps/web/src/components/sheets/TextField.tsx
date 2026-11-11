import { useState } from 'react';

import { FieldError } from '@/components/FieldError';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

interface TextFieldProps {
  id: string;
  label: string;
  /** The stored value when the form opened; the input keeps its own text after that. */
  initial: string;
  maxLength: number;
  /** A textarea instead of a one-line input. */
  multiline?: boolean;
  disabled: boolean;
  error: string | null;
  onCommit: (value: string) => void;
  onBlur: () => void;
}

/** A top-level text field of a sheet or stat block (class name, role…). */
export function TextField({
  id,
  label,
  initial,
  maxLength,
  multiline = false,
  disabled,
  error,
  onCommit,
  onBlur,
}: TextFieldProps) {
  const [draft, setDraft] = useState(initial);
  const props = {
    id,
    value: draft,
    maxLength,
    disabled,
    'aria-invalid': error !== null,
    onBlur,
  };

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {multiline ? (
        <Textarea
          {...props}
          onChange={(event) => {
            setDraft(event.target.value);
            onCommit(event.target.value);
          }}
        />
      ) : (
        <Input
          {...props}
          onChange={(event) => {
            setDraft(event.target.value);
            onCommit(event.target.value);
          }}
        />
      )}
      <FieldError message={error} />
    </div>
  );
}
