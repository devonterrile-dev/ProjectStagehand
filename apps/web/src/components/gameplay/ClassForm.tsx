import { FEATURE_LIST_MAX, type FeatureRow } from '@stagehand/shared';

import { FieldError } from '@/components/FieldError';
import { ListEditor } from '@/components/sheets/ListEditor';
import { NamedTextFields } from '@/components/sheets/parts';

/**
 * A list of features (name and text) in the GM's class and subclass forms (F4.5): class features
 * and a subclass's foundation, specialization and mastery. Each change hands back the whole list.
 */
export function FeatureListField({
  id,
  title,
  description,
  itemLabel,
  initial,
  error,
  onChange,
  onBlur,
}: {
  id: string;
  title: string;
  description?: string;
  /** Names one row in labels, e.g. "Foundation feature" → "Foundation feature 2 name". */
  itemLabel: string;
  initial: FeatureRow[];
  error: string | null;
  /** `now` asks for an immediate save (a row added or removed). */
  onChange: (rows: FeatureRow[], now: boolean) => void;
  onBlur: () => void;
}) {
  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-medium">{title}</legend>
      {description !== undefined && <p className="text-sm text-muted-foreground">{description}</p>}
      <ListEditor<FeatureRow>
        id={id}
        itemLabel={itemLabel}
        value={initial}
        empty={() => ({ name: '', text: '' })}
        isComplete={(row) => row.name.trim() !== ''}
        max={FEATURE_LIST_MAX}
        disabled={false}
        emptyText="None yet."
        renderRow={(row, set, index) => (
          <NamedTextFields
            label={`${itemLabel} ${String(index + 1)}`}
            value={{ name: row.name, description: row.text }}
            set={(next, now) => {
              set({ name: next.name, text: next.description }, now);
            }}
            disabled={false}
            onBlur={onBlur}
          />
        )}
        onChange={onChange}
      />
      <FieldError message={error} />
    </fieldset>
  );
}
