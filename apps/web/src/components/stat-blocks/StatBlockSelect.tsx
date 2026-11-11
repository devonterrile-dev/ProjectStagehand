import type { StatBlockSummary } from '@stagehand/shared';
import { Link } from 'react-router';

import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { statBlockPath } from '@/lib/records';

interface StatBlockSelectProps {
  campaignId: string;
  statBlocks: StatBlockSummary[];
  /** The linked stat block's id, or '' for none. */
  value: string;
  disabled: boolean;
  onChange: (statBlockId: string | null) => void;
}

/** An NPC's stat block, for when it may fight (governance §8). */
export function StatBlockSelect({
  campaignId,
  statBlocks,
  value,
  disabled,
  onChange,
}: StatBlockSelectProps) {
  return (
    <div className="space-y-2">
      <Label htmlFor="record-stat-block">Stat block</Label>
      <div className="flex items-center gap-3">
        <NativeSelect
          id="record-stat-block"
          value={value}
          disabled={disabled}
          onChange={(event) => {
            onChange(event.target.value === '' ? null : event.target.value);
          }}
        >
          <option value="">None</option>
          {statBlocks.map((block) => (
            <option key={block.id} value={block.id}>
              {block.name} (tier {block.tier})
            </option>
          ))}
        </NativeSelect>
        {value !== '' && (
          <Link to={statBlockPath(campaignId, value)} className="text-sm underline">
            Open
          </Link>
        )}
      </div>
      <p className="text-xs text-muted-foreground">For when this NPC may fight.</p>
    </div>
  );
}
