import type { MeResponse } from '@stagehand/shared';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';

export function UserAvatar({ me, className }: { me: MeResponse; className?: string }) {
  return (
    <Avatar className={className}>
      {me.avatarUrl !== null && <AvatarImage src={me.avatarUrl} alt="" />}
      <AvatarFallback>{me.displayName.slice(0, 1).toUpperCase()}</AvatarFallback>
    </Avatar>
  );
}
