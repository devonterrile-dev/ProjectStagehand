import { inviteExpirySchema, type Invite, type InviteExpiry } from '@stagehand/shared';
import { CopyIcon } from 'lucide-react';
import { useState } from 'react';

import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { useCreateInvite, useInvites, useRevokeInvite } from '@/lib/queries';

const EXPIRY_LABELS: Record<InviteExpiry, string> = {
  never: 'Never',
  '1d': 'In 1 day',
  '7d': 'In 7 days',
};

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/** The full link a player opens. */
function inviteUrl(invite: Invite): string {
  return `${window.location.origin}/join/${invite.code}`;
}

/** GM only, active campaigns only: create, copy and revoke invite links. */
export function InvitesPanel({ campaignId }: { campaignId: string }) {
  const { data: invites, isPending, isError } = useInvites(campaignId, true);
  const create = useCreateInvite(campaignId);
  const revoke = useRevokeInvite(campaignId);
  const [expiresIn, setExpiresIn] = useState<InviteExpiry>('7d');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<Invite | null>(null);

  async function handleCopy(invite: Invite) {
    try {
      await navigator.clipboard.writeText(inviteUrl(invite));
      setCopiedId(invite.id);
    } catch {
      setCopiedId(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2 className="text-xl">Invite players</h2>
        </CardTitle>
        <CardDescription>
          Anyone with an active link can join as a player. Share it in your group&apos;s Discord.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-2">
            <Label htmlFor="invite-expiry">Link expires</Label>
            <select
              id="invite-expiry"
              className="h-9 rounded-md border bg-transparent px-3 text-sm"
              value={expiresIn}
              onChange={(event) => {
                setExpiresIn(inviteExpirySchema.parse(event.target.value));
              }}
            >
              {inviteExpirySchema.options.map((option) => (
                <option key={option} value={option}>
                  {EXPIRY_LABELS[option]}
                </option>
              ))}
            </select>
          </div>
          <Button
            disabled={create.isPending}
            onClick={() => {
              create.mutate(expiresIn);
            }}
          >
            Create invite link
          </Button>
        </div>
        {create.isError && (
          <p role="alert" className="text-sm text-destructive">
            {create.error.message}
          </p>
        )}

        {isPending && <p className="text-muted-foreground">Loading invite links…</p>}
        {isError && <p role="alert">Could not load invite links. Try again in a moment.</p>}
        {invites?.length === 0 && (
          <p className="text-sm text-muted-foreground">No active invite links.</p>
        )}
        {invites !== undefined && invites.length > 0 && (
          <ul className="divide-y rounded-md border" aria-label="Invite links">
            {invites.map((invite) => (
              <li key={invite.id} className="space-y-2 px-4 py-3">
                <code className="block truncate text-sm">{inviteUrl(invite)}</code>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs text-muted-foreground">
                    {invite.expiresAt === null
                      ? 'Never expires'
                      : `Expires ${dateFormat.format(new Date(invite.expiresAt))}`}
                  </span>
                  <div className="flex items-center gap-2">
                    {copiedId === invite.id && (
                      <span role="status" className="text-xs text-muted-foreground">
                        Copied
                      </span>
                    )}
                    <Button size="sm" variant="outline" onClick={() => void handleCopy(invite)}>
                      <CopyIcon aria-hidden />
                      Copy link
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setRevoking(invite);
                      }}
                    >
                      Revoke
                    </Button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      {revoking !== null && (
        <ConfirmDialog
          open
          onOpenChange={(open) => {
            if (!open) setRevoking(null);
          }}
          title="Revoke this invite link?"
          description="Nobody can join with it any more. People who already joined stay in the campaign."
          confirmLabel="Revoke"
          onConfirm={() => revoke.mutateAsync(revoking.id)}
        />
      )}
    </Card>
  );
}
