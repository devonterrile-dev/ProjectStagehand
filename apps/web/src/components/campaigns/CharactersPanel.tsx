import { CHARACTER_NAME_MAX, characterNameSchema, type Campaign } from '@stagehand/shared';
import { PlusIcon } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';

import { CampaignNameDialog } from '@/components/campaigns/CampaignNameDialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useCharacters, useCreateCharacter, useMe, useMembers } from '@/lib/queries';
import { characterPath } from '@/lib/records';

/**
 * PCs on the campaign page. The GM sees every PC, assigned or not, and can create one;
 * a player sees a link to their own PC's sheet.
 */
export function CharactersPanel({ campaign }: { campaign: Campaign }) {
  return campaign.role === 'gm' ? (
    <GmCharacters campaign={campaign} />
  ) : (
    <YourCharacter campaign={campaign} />
  );
}

function GmCharacters({ campaign }: { campaign: Campaign }) {
  const { data: characters, isPending, isError } = useCharacters(campaign.id, true);
  const { data: members } = useMembers(campaign.id);
  const create = useCreateCharacter(campaign.id);
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const isArchived = campaign.archivedAt !== null;

  const playerName = (userId: string | null) =>
    members?.find((member) => member.userId === userId)?.displayName;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4">
        <div className="space-y-1.5">
          <CardTitle>
            <h2 className="text-xl">Characters</h2>
          </CardTitle>
          <CardDescription>
            Every PC and their sheet. Assign PCs to players under Members.
          </CardDescription>
        </div>
        {!isArchived && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setCreating(true);
            }}
          >
            <PlusIcon aria-hidden />
            New PC
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {isPending && <p className="text-muted-foreground">Loading characters…</p>}
        {isError && <p role="alert">Could not load the characters. Try again in a moment.</p>}
        {characters?.length === 0 && (
          <p className="text-sm text-muted-foreground">No PCs yet. Create one with New PC.</p>
        )}
        {characters !== undefined && characters.length > 0 && (
          <ul className="divide-y rounded-md border" aria-label="Characters">
            {characters.map((character) => {
              const player = playerName(character.assignedToUserId);
              return (
                <li key={character.id}>
                  <Link
                    to={characterPath(campaign.id, character.id)}
                    className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-3 hover:bg-muted"
                  >
                    <span className="font-medium">{character.name}</span>
                    <span className="text-sm text-muted-foreground">
                      {player === undefined ? 'Unassigned' : `Played by ${player}`}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>

      <CampaignNameDialog
        open={creating}
        onOpenChange={setCreating}
        title="New PC"
        description="Give the PC a name. You can fill in the sheet and assign a player after."
        submitLabel="Create PC"
        label="Character name"
        schema={characterNameSchema}
        maxLength={CHARACTER_NAME_MAX}
        onSave={async (name) => {
          const character = await create.mutateAsync({ name });
          void navigate(characterPath(campaign.id, character.id));
        }}
      />
    </Card>
  );
}

function YourCharacter({ campaign }: { campaign: Campaign }) {
  const { data: me } = useMe();
  const { data: members } = useMembers(campaign.id);
  const mine = members?.find((member) => member.userId === me?.id)?.character ?? null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4">
        <div className="space-y-1.5">
          <CardTitle>
            <h2 className="text-xl">Your character</h2>
          </CardTitle>
          <CardDescription>
            {mine === null ? "The GM hasn't given you a PC yet." : mine.name}
          </CardDescription>
        </div>
        {mine !== null && (
          <Button asChild size="sm" variant="outline">
            <Link to={characterPath(campaign.id, mine.id)}>Open sheet</Link>
          </Button>
        )}
      </CardHeader>
    </Card>
  );
}
