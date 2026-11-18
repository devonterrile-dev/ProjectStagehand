import type { Presence } from '@stagehand/shared';

import { UserAvatar } from '@/components/UserAvatar';

/**
 * Everyone connected to the session: a picture, a name, and their PC or "GM"; a ring round the
 * picture of whoever is talking (F3.7). While the GM voices an NPC (F3.8) the talking is the
 * NPC's, not theirs: their picture stays plain, and only the GM's own list (`npcName`, which
 * finds the NPC on the GM's stage) says whose voice it is.
 */
export function PresenceList({
  presence,
  npcName,
}: {
  presence: Presence;
  npcName?: (objectId: string) => string | undefined;
}) {
  return (
    <ul aria-label="Who is here" className="space-y-1.5">
      {presence.map((person) => {
        const voicing = person.voicing === null ? undefined : npcName?.(person.voicing);
        const talking = person.speaking && (person.voicing === null || voicing !== undefined);
        return (
          <li
            key={person.userId}
            className="flex items-center gap-2"
            {...(talking ? { 'data-speaking': '' } : {})}
          >
            <UserAvatar
              user={person}
              className={`size-6 rounded-full ${talking ? 'ring-2 ring-amber-300' : ''}`}
            />
            {talking && <span className="sr-only">(talking)</span>}
            <span className="min-w-0 truncate">{person.displayName}</span>
            <span className="ml-auto shrink-0 text-xs text-muted-foreground">
              {person.role === 'gm'
                ? voicing === undefined
                  ? 'GM'
                  : `as ${voicing}`
                : (person.characterName ?? 'No PC yet')}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
