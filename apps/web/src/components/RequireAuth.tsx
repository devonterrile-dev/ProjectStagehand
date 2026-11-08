import type { ReactNode } from 'react';
import { Navigate } from 'react-router';

import { useMe } from '@/lib/queries';

/** Renders children for a signed-in user; sends anyone else to the sign-in page. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { data: me, isPending, isError } = useMe();

  if (isPending) return <p className="text-muted-foreground">Loading…</p>;
  if (isError) return <p role="alert">Could not reach Stagehand. Try again in a moment.</p>;
  if (me === null) return <Navigate to="/" replace />;
  return children;
}
