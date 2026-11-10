import type { RecordSummary } from '@stagehand/shared';

interface AreaSelectProps {
  id: string;
  /** Record summaries already filtered to Areas. */
  areas: RecordSummary[];
  value: string;
  disabled?: boolean;
  /** A blank first option with this text, for forms where no Area is chosen yet. */
  placeholder?: string;
  onChange: (areaId: string) => void;
}

/** The Area a Spot belongs to (D-15). */
export function AreaSelect({
  id,
  areas,
  value,
  disabled = false,
  placeholder,
  onChange,
}: AreaSelectProps) {
  return (
    <select
      id={id}
      className="h-9 w-full rounded-md border bg-transparent px-3 text-sm"
      value={value}
      disabled={disabled}
      onChange={(event) => {
        onChange(event.target.value);
      }}
    >
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {areas.map((area) => (
        <option key={area.id} value={area.id}>
          {area.name}
        </option>
      ))}
    </select>
  );
}
