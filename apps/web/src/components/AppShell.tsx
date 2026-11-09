import type { ReactNode } from 'react';
import { Link } from 'react-router';

import { UserAvatar } from '@/components/UserAvatar';
import { useMe } from '@/lib/queries';

export function AppShell({ children }: { children: ReactNode }) {
  const { data: me } = useMe();

  return (
    <div className="min-h-svh bg-background text-foreground">
      <header className="border-b">
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between px-4">
          <Link to="/" className="text-lg font-bold tracking-tight">
            Stagehand
          </Link>
          {me && (
            <Link
              to="/profile"
              className="flex items-center gap-2 text-sm font-medium"
              aria-label="Your profile"
            >
              <span className="hidden sm:inline">{me.displayName}</span>
              <UserAvatar user={me} className="size-8" />
            </Link>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-10">{children}</main>
    </div>
  );
}
