import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';

import { CampaignList } from '@/components/campaigns/CampaignList';
import { SignInCard } from '@/components/SignInCard';
import { UserAvatar } from '@/components/UserAvatar';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useMe } from '@/lib/queries';

/**
 * Better Auth sends failed sign-ins (cancelled on Discord, expired or missing OAuth state)
 * back to `/?error=<code>`. Read the code once, then drop it from the URL so a reload, a
 * bookmark or a shared link doesn't keep showing a stale error.
 */
function useSignInErrorOnce(): string | null {
  const [searchParams, setSearchParams] = useSearchParams();
  const [error] = useState(() => searchParams.get('error'));

  useEffect(() => {
    if (!searchParams.has('error')) return;
    const next = new URLSearchParams(searchParams);
    next.delete('error');
    next.delete('error_description');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  return error;
}

export function HomePage() {
  const { data: me, isPending, isError } = useMe();
  const signInError = useSignInErrorOnce();

  if (isPending) return <p className="text-muted-foreground">Loading…</p>;
  if (isError) return <p role="alert">Could not reach Stagehand. Try again in a moment.</p>;
  // Signed in already: a leftover sign-in error is irrelevant, so it's never shown.
  if (me === null) return <SignInCard callbackError={signInError} />;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <UserAvatar user={me} className="size-14" />
            <div>
              <CardTitle>
                <h1 className="text-2xl">Welcome, {me.displayName}</h1>
              </CardTitle>
              <CardDescription>Pick up a campaign, or start a new one.</CardDescription>
            </div>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link to="/profile">Edit profile</Link>
          </Button>
        </CardHeader>
      </Card>
      <CampaignList />
    </div>
  );
}
