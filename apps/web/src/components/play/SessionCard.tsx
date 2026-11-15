import type { Campaign } from '@stagehand/shared';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';

import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useEndPlaySession, usePlaySession, useStartPlaySession } from '@/lib/queries';
import { playPath } from '@/play/stage';

/**
 * The campaign page's way into a live session (F3.3, governance §13 "Session lifecycle"). The
 * GM starts one, opens the stage and ends it; a player joins the one that is running.
 */
export function SessionCard({ campaign }: { campaign: Campaign }) {
  const navigate = useNavigate();
  const session = usePlaySession(campaign.id);
  const start = useStartPlaySession(campaign.id);
  const end = useEndPlaySession(campaign.id);
  const [ending, setEnding] = useState(false);

  const isGm = campaign.role === 'gm';
  const archived = campaign.archivedAt !== null;
  const running = session.data ?? null;

  let status: string;
  if (session.isPending) status = 'Checking for a session…';
  else if (session.isError) status = 'Could not check for a session. Try again in a moment.';
  else if (running !== null) status = `Session ${String(running.number)} is running.`;
  else if (!isGm) status = 'No session right now. When your GM starts one, you can join it here.';
  else if (archived) status = "An archived campaign can't start a session.";
  else status = 'No session is running. Start one when your players are ready.';

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4">
        <div className="space-y-1.5">
          <CardTitle>
            <h2 className="text-xl">Session</h2>
          </CardTitle>
          <CardDescription role={session.isError ? 'alert' : undefined}>{status}</CardDescription>
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-2">
          {running !== null && (
            <Button asChild size="sm">
              <Link to={playPath(campaign.id)}>{isGm ? 'Open the stage' : 'Join the session'}</Link>
            </Button>
          )}
          {running !== null && isGm && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setEnding(true);
              }}
            >
              End session
            </Button>
          )}
          {running === null && isGm && !archived && session.isSuccess && (
            <Button
              size="sm"
              disabled={start.isPending}
              onClick={() => {
                start.mutate(undefined, {
                  onSuccess: () => void navigate(playPath(campaign.id)),
                });
              }}
            >
              Start session
            </Button>
          )}
        </div>
      </CardHeader>
      {start.isError && (
        <CardContent>
          <p role="alert" className="text-sm text-destructive">
            {start.error.message}
          </p>
        </CardContent>
      )}

      <ConfirmDialog
        open={ending}
        onOpenChange={setEnding}
        title="End the session?"
        description="The theater closes for everyone. You can start a new session whenever you like."
        confirmLabel="End session"
        onConfirm={() => end.mutateAsync()}
      />
    </Card>
  );
}
