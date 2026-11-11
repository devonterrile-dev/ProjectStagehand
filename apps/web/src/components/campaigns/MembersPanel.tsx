import type { Campaign, Member } from '@stagehand/shared';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';

import { AssignPcDialog } from '@/components/campaigns/AssignPcDialog';
import { CampaignRoleBadge } from '@/components/campaigns/CampaignRoleBadge';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { UserAvatar } from '@/components/UserAvatar';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useLeaveCampaign, useMe, useMembers, useRemoveMember } from '@/lib/queries';
import { characterPath } from '@/lib/records';

type Pending = { kind: 'assign' | 'remove'; member: Member } | { kind: 'leave' } | null;

/** Everyone in the campaign and their PCs. The GM manages players; a player can leave. */
export function MembersPanel({ campaign }: { campaign: Campaign }) {
  const { data: me } = useMe();
  const { data: members, isPending, isError } = useMembers(campaign.id);
  const removeMember = useRemoveMember(campaign.id);
  const leave = useLeaveCampaign(campaign.id);
  const navigate = useNavigate();
  const [pending, setPending] = useState<Pending>(null);

  const isGm = campaign.role === 'gm';
  const isArchived = campaign.archivedAt !== null;
  const close = (open: boolean) => {
    if (!open) setPending(null);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2 className="text-xl">Members</h2>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isPending && <p className="text-muted-foreground">Loading members…</p>}
        {isError && <p role="alert">Could not load the members. Try again in a moment.</p>}
        {members !== undefined && (
          <ul className="divide-y rounded-md border" aria-label="Members">
            {members.map((member) => {
              const isMe = member.userId === me?.id;
              return (
                <li
                  key={member.userId}
                  className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
                >
                  <div className="flex items-center gap-3">
                    <UserAvatar user={member} className="size-9" />
                    <div>
                      <p className="font-medium">
                        {member.displayName}
                        {isMe && <span className="text-muted-foreground"> (you)</span>}
                      </p>
                      {member.role === 'player' && (
                        <p className="text-sm text-muted-foreground">
                          {member.character === null ? (
                            'No PC yet'
                          ) : isGm ? (
                            <>
                              Plays{' '}
                              <Link
                                to={characterPath(campaign.id, member.character.id)}
                                className="underline"
                              >
                                {member.character.name}
                              </Link>
                            </>
                          ) : (
                            `Plays ${member.character.name}`
                          )}
                        </p>
                      )}
                    </div>
                    <CampaignRoleBadge role={member.role} />
                  </div>

                  <div className="flex gap-2">
                    {isGm && member.role === 'player' && (
                      <>
                        {!isArchived && (
                          <Button
                            size="sm"
                            variant="outline"
                            aria-label={`Set PC for ${member.displayName}`}
                            onClick={() => {
                              setPending({ kind: 'assign', member });
                            }}
                          >
                            {member.character === null ? 'Assign PC' : 'Change PC'}
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label={`Remove ${member.displayName}`}
                          onClick={() => {
                            setPending({ kind: 'remove', member });
                          }}
                        >
                          Remove
                        </Button>
                      </>
                    )}
                    {!isGm && isMe && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setPending({ kind: 'leave' });
                        }}
                      >
                        Leave campaign
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>

      {pending?.kind === 'assign' && members !== undefined && (
        <AssignPcDialog
          campaignId={campaign.id}
          player={pending.member}
          members={members}
          open
          onOpenChange={close}
        />
      )}
      {pending?.kind === 'remove' && (
        <ConfirmDialog
          open
          onOpenChange={close}
          title={`Remove ${pending.member.displayName}?`}
          description="They lose access to this campaign. Their PC stays here, unassigned. You can invite them again later."
          confirmLabel="Remove"
          onConfirm={() => removeMember.mutateAsync(pending.member.userId)}
        />
      )}
      {pending?.kind === 'leave' && me && (
        <ConfirmDialog
          open
          onOpenChange={close}
          title={`Leave ${campaign.name}?`}
          description="You lose access to this campaign. Your PC stays with the GM. You'll need a new invite to come back."
          confirmLabel="Leave"
          onConfirm={async () => {
            await leave.mutateAsync(me.id);
            void navigate('/', { replace: true });
          }}
        />
      )}
    </Card>
  );
}
