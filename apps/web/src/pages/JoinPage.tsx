import type { InvitePreview } from '@stagehand/shared';
import { Link, useNavigate, useParams } from 'react-router';

import { SignInCard } from '@/components/SignInCard';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useAcceptInvite, useInvitePreview, useMe } from '@/lib/queries';

/**
 * `/join/:code`: where an invite link lands. Signed-out visitors sign in with Discord and
 * come straight back here; signed-in users see which campaign it is and join.
 */
export function JoinPage() {
  const { code = '' } = useParams();
  const { data: me, isPending, isError } = useMe();

  if (isPending) return <p className="text-muted-foreground">Loading…</p>;
  if (isError) return <p role="alert">Could not reach Stagehand. Try again in a moment.</p>;
  if (me === null) {
    return (
      <SignInCard
        returnTo={`/join/${encodeURIComponent(code)}`}
        title="You've been invited to a campaign"
        description="Sign in with Discord to see the invite and join."
      />
    );
  }
  return <InviteDetails code={code} />;
}

function InviteDetails({ code }: { code: string }) {
  const { data: preview, isPending, isError } = useInvitePreview(code, true);

  if (isPending) return <p className="text-muted-foreground">Loading invite…</p>;
  if (isError) return <p role="alert">Could not load this invite. Try again in a moment.</p>;
  if (preview === null) return <InvalidInvite />;
  return <JoinCard code={code} preview={preview} />;
}

function JoinCard({ code, preview }: { code: string; preview: InvitePreview }) {
  const accept = useAcceptInvite();
  const navigate = useNavigate();
  const campaignUrl = `/campaigns/${preview.campaignId}`;

  function handleJoin() {
    accept.mutate(code, {
      onSuccess: (campaignId) => {
        void navigate(`/campaigns/${campaignId}`, { replace: true });
      },
    });
  }

  return (
    <Card className="mx-auto max-w-md">
      <CardHeader>
        <CardTitle>
          <h1 className="text-2xl">{preview.campaignName}</h1>
        </CardTitle>
        <CardDescription>Run by {preview.gmDisplayName}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {preview.alreadyMember ? (
          <>
            <p>You&apos;re already in this campaign.</p>
            <Button asChild className="w-full">
              <Link to={campaignUrl}>Open campaign</Link>
            </Button>
          </>
        ) : (
          <>
            <p>You&apos;ve been invited to join as a player.</p>
            {accept.isError && (
              <p role="alert" className="text-sm text-destructive">
                {accept.error.message}
              </p>
            )}
            <Button className="w-full" onClick={handleJoin} disabled={accept.isPending}>
              {accept.isPending ? 'Joining…' : 'Join campaign'}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function InvalidInvite() {
  return (
    <div className="space-y-2">
      <h1 className="text-2xl font-bold">This invite link doesn&apos;t work</h1>
      <p className="text-muted-foreground">
        It may have expired or been revoked. Ask your GM for a new one.
      </p>
      <Link to="/" className="underline">
        Go to Stagehand
      </Link>
    </div>
  );
}
