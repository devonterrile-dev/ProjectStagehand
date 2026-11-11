import { displayNameSchema, type MeResponse } from '@stagehand/shared';
import { useState, type SubmitEvent } from 'react';
import { Link, useNavigate } from 'react-router';

import { UserAvatar } from '@/components/UserAvatar';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useMe, useSignOut, useUpdateMe } from '@/lib/queries';

/** Rendered inside RequireAuth, so the user is signed in. */
export function ProfilePage() {
  const { data: me } = useMe();
  if (!me) return null;
  return <Profile me={me} />;
}

function Profile({ me }: { me: MeResponse }) {
  const navigate = useNavigate();
  const updateMe = useUpdateMe();
  const signOut = useSignOut();
  const [name, setName] = useState(me.displayName);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function handleSubmit(event: SubmitEvent) {
    event.preventDefault();
    const parsed = displayNameSchema.safeParse(name);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Invalid display name');
      return;
    }
    setError(null);
    updateMe.mutate(
      { displayName: parsed.data },
      {
        onSuccess: (updated) => {
          setName(updated.displayName);
          setSaved(true);
        },
        onError: (mutationError) => {
          setError(mutationError.message);
        },
      },
    );
  }

  function handleReset() {
    setError(null);
    updateMe.mutate(
      { displayName: null },
      {
        onSuccess: (updated) => {
          setName(updated.displayName);
          setSaved(true);
        },
        onError: (mutationError) => {
          setError(mutationError.message);
        },
      },
    );
  }

  function handleSignOut() {
    signOut.mutate(undefined, {
      onSuccess: () => {
        void navigate('/', { replace: true });
      },
    });
  }

  return (
    <Card className="mx-auto max-w-md">
      <CardHeader className="flex flex-row items-center gap-4">
        <UserAvatar user={me} className="size-16" />
        <div>
          <CardTitle>
            <h1 className="text-2xl">{me.displayName}</h1>
          </CardTitle>
          <CardDescription>Discord: @{me.discordUsername}</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <form className="space-y-2" onSubmit={handleSubmit} noValidate>
          <Label htmlFor="display-name">Display name</Label>
          <Input
            id="display-name"
            value={name}
            maxLength={32}
            aria-invalid={error !== null}
            aria-describedby="display-name-help"
            onChange={(event) => {
              setName(event.target.value);
              setSaved(false);
            }}
          />
          <p id="display-name-help" className="text-xs text-muted-foreground">
            How you appear to your group. Your avatar always comes from Discord.
          </p>
          {error !== null && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          {saved && error === null && (
            <p role="status" className="text-sm text-muted-foreground">
              Saved.
            </p>
          )}
          <div className="flex gap-2 pt-2">
            <Button type="submit" disabled={updateMe.isPending}>
              Save
            </Button>
            {me.hasCustomDisplayName && (
              <Button
                type="button"
                variant="ghost"
                disabled={updateMe.isPending}
                onClick={handleReset}
              >
                Use my Discord name
              </Button>
            )}
          </div>
        </form>

        <div className="flex items-center justify-between gap-2 border-t pt-4">
          <Button variant="outline" onClick={handleSignOut} disabled={signOut.isPending}>
            Sign out
          </Button>
          <Link to="/settings" className="text-sm underline">
            Settings and AI keys
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
