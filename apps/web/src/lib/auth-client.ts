import { createAuthClient } from 'better-auth/react';

/**
 * Better Auth client. Same origin as the app (Vite proxies /api in dev), default
 * base path /api/auth, matching the server.
 */
export const authClient = createAuthClient();

/**
 * Starts Sign in with Discord: the browser leaves for Discord and comes back to `returnTo`.
 * If sign-in fails (e.g. the user cancels), Better Auth sends them to `/?error=<code>`.
 */
export async function signInWithDiscord(returnTo = '/'): Promise<void> {
  await authClient.signIn.social({
    provider: 'discord',
    callbackURL: returnTo,
    errorCallbackURL: '/',
  });
}

export async function signOut(): Promise<void> {
  await authClient.signOut();
}
