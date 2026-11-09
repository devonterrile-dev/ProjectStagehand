import type { CampaignRole } from '@stagehand/shared';

import { Badge } from '@/components/ui/badge';

export function CampaignRoleBadge({ role }: { role: CampaignRole }) {
  return (
    <Badge variant={role === 'gm' ? 'default' : 'secondary'}>
      {role === 'gm' ? 'GM' : 'Player'}
    </Badge>
  );
}
