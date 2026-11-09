import type {
  Campaign,
  CreateCharacterRequest,
  InviteExpiry,
  MeResponse,
  UpdateMeRequest,
} from '@stagehand/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  acceptInvite,
  assignCharacter,
  createCampaign,
  createCharacter,
  createInvite,
  fetchCampaign,
  fetchCampaigns,
  fetchCharacters,
  fetchInvitePreview,
  fetchInvites,
  fetchMe,
  fetchMembers,
  removeMember,
  renameCampaign,
  revokeInvite,
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

type CampaignPart = 'members' | 'characters' | 'invites';
const partKey = (campaignId: string, part: CampaignPart) =>
  [...CAMPAIGNS_KEY, campaignId, part] as const;

/** Refetches parts of one campaign after a change. */
function useRefetch(campaignId: string, ...parts: CampaignPart[]) {
  const queryClient = useQueryClient();
  return () => {
    for (const part of parts) {
      void queryClient.invalidateQueries({ queryKey: partKey(campaignId, part) });
    }
  };
}

/** The campaign's members (any member can see the roster). */
export function useMembers(campaignId: string) {
  return useQuery({
    queryKey: partKey(campaignId, 'members'),
    queryFn: () => fetchMembers(campaignId),
  });
}

/** The campaign's PCs. GM only: pass `enabled: false` for players. */
export function useCharacters(campaignId: string, enabled: boolean) {
  return useQuery({
    queryKey: partKey(campaignId, 'characters'),
    queryFn: () => fetchCharacters(campaignId),
    enabled,
  });
}

/** The campaign's active invite links. GM only: pass `enabled: false` for players. */
export function useInvites(campaignId: string, enabled: boolean) {
  return useQuery({
    queryKey: partKey(campaignId, 'invites'),
    queryFn: () => fetchInvites(campaignId),
    enabled,
  });
}

/** The GM removes a player. */
export function useRemoveMember(campaignId: string) {
  return useMutation({
    mutationFn: (userId: string) => removeMember(campaignId, userId),
    onSuccess: useRefetch(campaignId, 'members', 'characters'),
  });
}

/** The signed-in player leaves the campaign. Callers navigate away on success. */
export function useLeaveCampaign(campaignId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (myUserId: string) => removeMember(campaignId, myUserId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: CAMPAIGNS_KEY, exact: true });
    },
  });
}

export function useAssignCharacter(campaignId: string) {
  return useMutation({
    mutationFn: ({ userId, characterId }: { userId: string; characterId: string | null }) =>
      assignCharacter(campaignId, userId, characterId),
    onSuccess: useRefetch(campaignId, 'members', 'characters'),
  });
}

export function useCreateCharacter(campaignId: string) {
  return useMutation({
    mutationFn: (input: CreateCharacterRequest) => createCharacter(campaignId, input),
    onSuccess: useRefetch(campaignId, 'members', 'characters'),
  });
}

export function useCreateInvite(campaignId: string) {
  return useMutation({
    mutationFn: (expiresIn: InviteExpiry) => createInvite(campaignId, expiresIn),
    onSuccess: useRefetch(campaignId, 'invites'),
  });
}

export function useRevokeInvite(campaignId: string) {
  return useMutation({
    mutationFn: (inviteId: string) => revokeInvite(campaignId, inviteId),
    onSuccess: useRefetch(campaignId, 'invites'),
  });
}

/** What an invite link leads to (`null` when it's no longer valid). Signed-in users only. */
export function useInvitePreview(code: string, enabled: boolean) {
  return useQuery({
    queryKey: ['invite', code],
    queryFn: () => fetchInvitePreview(code),
    enabled,
  });
}

/** Joins a campaign through an invite; resolves to the campaign id. */
export function useAcceptInvite() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: acceptInvite,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: CAMPAIGNS_KEY });
    },
  });
}
