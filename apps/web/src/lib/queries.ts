import type { MeResponse, UpdateMeRequest } from '@stagehand/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { fetchMe, updateMe } from './api';
import { signOut } from './auth-client';

const ME_KEY = ['me'] as const;

/** The signed-in user (`null` when signed out). */
export function useMe() {
  return useQuery({ queryKey: ME_KEY, queryFn: fetchMe, staleTime: 60_000 });
}

export function useUpdateMe() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (update: UpdateMeRequest) => updateMe(update),
    onSuccess: (me: MeResponse) => {
      queryClient.setQueryData(ME_KEY, me);
    },
  });
}

export function useSignOut() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: signOut,
    onSuccess: () => {
      queryClient.setQueryData(ME_KEY, null);
      queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== ME_KEY[0] });
    },
  });
}
