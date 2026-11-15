import type { Presence } from '@stagehand/shared';

import { UserAvatar } from '@/components/UserAvatar';

/** Everyone connected to the session: a picture, a name, and their PC or "GM". */
export function PresenceList({ presence }: { presence: Presence }) {
  return (
    <ul aria-label="Who is here" className="space-y-1.5">
      {presence.map((person) => (
        <li key={person.userId} className="flex items-center gap-2">
          <UserAvatar user={person} className="size-6" />
          <span className="min-w-0 truncate">{person.displayName}</span>
          <span className="ml-auto shrink-0 text-xs text-muted-foreground">
            {person.role === 'gm' ? 'GM' : (person.characterName ?? 'No PC yet')}
          </span>
        </li>
      ))}
    </ul>
  );
}
