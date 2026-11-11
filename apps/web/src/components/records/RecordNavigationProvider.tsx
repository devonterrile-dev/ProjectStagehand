import { useCallback, useMemo, useRef, type ReactNode } from 'react';
import { useNavigate } from 'react-router';

import { RecordNavigationContext, type Settle } from '@/lib/record-navigation';
import { recordPath } from '@/lib/records';

/** Gives a record page its waiting "Open" (see `lib/record-navigation.ts`). */
export function RecordNavigationProvider({
  campaignId,
  children,
}: {
  campaignId: string;
  children: ReactNode;
}) {
  const navigate = useNavigate();
  const settleRef = useRef<Settle | null>(null);

  const hrefOf = useCallback((recordId: string) => recordPath(campaignId, recordId), [campaignId]);
  const open = useCallback(
    async (recordId: string) => {
      const saved = (await settleRef.current?.()) ?? true;
      if (saved) await navigate(recordPath(campaignId, recordId));
    },
    [campaignId, navigate],
  );
  const register = useCallback((settle: Settle) => {
    settleRef.current = settle;
    return () => {
      if (settleRef.current === settle) settleRef.current = null;
    };
  }, []);

  const value = useMemo(() => ({ hrefOf, open, register }), [hrefOf, open, register]);
  return (
    <RecordNavigationContext.Provider value={value}>{children}</RecordNavigationContext.Provider>
  );
}
