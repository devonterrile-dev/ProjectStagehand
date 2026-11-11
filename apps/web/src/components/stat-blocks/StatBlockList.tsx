import type { StatBlockSummary } from '@stagehand/shared';
import { Link } from 'react-router';

import { Badge } from '@/components/ui/badge';
import { statBlockPath } from '@/lib/records';

export function StatBlockList({
  campaignId,
  statBlocks,
}: {
  campaignId: string;
  statBlocks: StatBlockSummary[];
}) {
  if (statBlocks.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No stat blocks yet. Create one with New stat block.
      </p>
    );
  }

  return (
    <ul className="divide-y rounded-md border" aria-label="Stat blocks">
      {statBlocks.map((block) => (
        <li key={block.id}>
          <Link
            to={statBlockPath(campaignId, block.id)}
            className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 hover:bg-muted"
          >
            <span className="font-medium">{block.name}</span>
            <Badge variant="secondary">Tier {block.tier}</Badge>
            {block.role !== '' && (
              <span className="text-sm text-muted-foreground">{block.role}</span>
            )}
            {block.usedByCount > 0 && (
              <span className="text-sm text-muted-foreground">
                used by {block.usedByCount} {block.usedByCount === 1 ? 'NPC' : 'NPCs'}
              </span>
            )}
          </Link>
        </li>
      ))}
    </ul>
  );
}
