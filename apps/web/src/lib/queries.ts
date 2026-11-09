import type { Campaign, MeResponse, UpdateMeRequest } from '@stagehand/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  createCampaign,
  fetchCampaign,
  fetchCampaigns,
  fetchMe,
  renameCampaign,
  setCampaignArchived,
  updateMe,
} from './api';
import { signOut } from './auth-client';

const ME_KEY = ['me'] as const;
const CAMPAIGNS_KEY = ['campaigns'] as const;

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

/** Every campaign the user belongs to, active and archived. */
export function useCampaigns() {
  return useQuery({ queryKey: CAMPAIGNS_KEY, queryFn: fetchCampaigns });
}

/** One campaign (`null` when not found or not a member). */
export function useCampaign(id: string) {
  return useQuery({ queryKey: [...CAMPAIGNS_KEY, id], queryFn: () => fetchCampaign(id) });
}

/** After a campaign changes: store the fresh copy, and refetch the list. */
function useCampaignSaved() {
  const queryClient = useQueryClient();
  return (campaign: Campaign) => {
    queryClient.setQueryData([...CAMPAIGNS_KEY, campaign.id], campaign);
    void queryClient.invalidateQueries({ queryKey: CAMPAIGNS_KEY, exact: true });
  };
}

export function useCreateCampaign() {
  return useMutation({ mutationFn: createCampaign, onSuccess: useCampaignSaved() });
}

export function useRenameCampaign() {
  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => renameCampaign(id, name),
    onSuccess: useCampaignSaved(),
  });
}

export function useSetCampaignArchived() {
  return useMutation({
    mutationFn: ({ id, archived }: { id: string; archived: boolean }) =>
      setCampaignArchived(id, archived),
    onSuccess: useCampaignSaved(),
  });
}
