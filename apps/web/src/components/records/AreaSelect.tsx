import type { RecordSummary } from '@stagehand/shared';

import { NativeSelect } from '@/components/ui/native-select';

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
    <NativeSelect
      id={id}
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
    </NativeSelect>
  );
}
