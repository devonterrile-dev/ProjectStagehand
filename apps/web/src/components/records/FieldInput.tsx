import {
  emptyRichText,
  isEmptyRichText,
  TEXT_FIELD_MAX,
  type ValueFieldSpec,
  type PointOfInterest,
  type RichText,
} from '@stagehand/shared';
import { useState } from 'react';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { enumLabel } from '@/lib/records';

import { PointsOfInterestEditor } from './PointsOfInterestEditor';
import { RichTextEditor } from './RichTextEditor';

interface FieldInputProps {
  id: string;
  spec: ValueFieldSpec;
  /** The stored value when the form opened; the input keeps its own state after that. */
  initial: unknown;
  disabled: boolean;
  error: string | null;
  /** A new value to save (null clears the field); `now` skips the debounce. */
  onCommit: (value: unknown, now: boolean) => void;
  /** The field lost focus: send what's pending. */
  onBlur: () => void;
}

const asString = (value: unknown) =>
  typeof value === 'string' || typeof value === 'number' ? String(value) : '';

/**
 * One private value field of a record, rendered by its kind from `RECORD_FIELD_SPECS`. Link
 * fields have their own input (`LinkFieldInput`).
 */
export function FieldInput({
  id,
  spec,
  initial,
  disabled,
  error,
  onCommit,
  onBlur,
}: FieldInputProps) {
  const [draft, setDraft] = useState(() => asString(initial));

  const invalid = error !== null;
  const errorLine = invalid && (
    <p role="alert" className="text-sm text-destructive">
      {error}
    </p>
  );

  if (spec.kind === 'rich') {
    const value = (initial as RichText | undefined) ?? emptyRichText();
    return (
      <div className="space-y-2">
        <Label>{spec.label}</Label>
        <RichTextEditor
          id={id}
          label={spec.label}
          value={value}
          editable={!disabled}
          onChange={(doc) => {
            onCommit(isEmptyRichText(doc) ? null : doc, false);
          }}
          onBlur={onBlur}
        />
        {errorLine}
      </div>
    );
  }

  if (spec.kind === 'list') {
    return (
      <div className="space-y-2">
        <Label>{spec.label}</Label>
        <PointsOfInterestEditor
          id={id}
          value={(initial as PointOfInterest[] | undefined) ?? []}
          disabled={disabled}
          onChange={(rows, now) => {
            onCommit(rows.length === 0 ? null : rows, now);
          }}
          onBlur={onBlur}
        />
        {errorLine}
      </div>
    );
  }

  let control;
  switch (spec.kind) {
    case 'text':
      control = (
        <Textarea
          id={id}
          value={draft}
          maxLength={TEXT_FIELD_MAX}
          disabled={disabled}
          aria-invalid={invalid}
          onChange={(event) => {
            setDraft(event.target.value);
            onCommit(event.target.value.trim() === '' ? null : event.target.value, false);
          }}
          onBlur={onBlur}
        />
      );
      break;
    case 'enum':
      control = (
        <NativeSelect
          id={id}
          value={draft}
          disabled={disabled}
          aria-invalid={invalid}
          onChange={(event) => {
            setDraft(event.target.value);
            onCommit(event.target.value === '' ? null : event.target.value, true);
          }}
        >
          <option value="">—</option>
          {(spec.options ?? []).map((option) => (
            <option key={option} value={option}>
              {enumLabel(option)}
            </option>
          ))}
        </NativeSelect>
      );
      break;
    case 'number':
      control = (
        <Input
          id={id}
          type="number"
          step={1}
          value={draft}
          disabled={disabled}
          aria-invalid={invalid}
          onChange={(event) => {
            setDraft(event.target.value);
            onCommit(event.target.value === '' ? null : Number(event.target.value), false);
          }}
          onBlur={onBlur}
        />
      );
      break;
    case 'date':
      control = (
        <Input
          id={id}
          type="date"
          value={draft}
          disabled={disabled}
          aria-invalid={invalid}
          onChange={(event) => {
            setDraft(event.target.value);
            onCommit(event.target.value === '' ? null : event.target.value, true);
          }}
        />
      );
      break;
  }

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{spec.label}</Label>
      {control}
      {errorLine}
    </div>
  );
}
