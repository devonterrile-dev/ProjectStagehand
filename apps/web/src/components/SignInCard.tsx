import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { signInWithDiscord } from '@/lib/auth-client';

interface SignInCardProps {
  /** A failed-sign-in code from the URL, shown as an error. */
  callbackError?: string | null;
  /** Where Discord sends the user back to after signing in. */
  returnTo?: string;
  title?: string;
  description?: string;
}

export function SignInCard({
  callbackError = null,
  returnTo = '/',
  title = 'Stagehand',
  description = 'Run story-first tabletop games online.',
}: SignInCardProps) {
  const [starting, setStarting] = useState(false);
  const [failed, setFailed] = useState(false);

  async function handleSignIn() {
    setStarting(true);
    setFailed(false);
    try {
      await signInWithDiscord(returnTo);
    } catch {
      setFailed(true);
      setStarting(false);
    }
  }

  return (
    <Card className="mx-auto max-w-md">
      <CardHeader>
        <CardTitle>
          <h1 className="text-2xl">{title}</h1>
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {(callbackError !== null || failed) && (
          <p role="alert" className="text-sm text-destructive">
            Sign-in didn&apos;t complete. Please try again.
          </p>
        )}
        <Button className="w-full" onClick={() => void handleSignIn()} disabled={starting}>
          {starting ? 'Opening Discord…' : 'Sign in with Discord'}
        </Button>
        <p className="text-xs text-muted-foreground">
          Stagehand uses your Discord name and avatar. Players never install anything.
        </p>
      </CardContent>
    </Card>
  );
}
