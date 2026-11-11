import type {
  Campaign,
  CharacterSheetPatch,
  CreateCharacterRequest,
  CreateRecordRequest,
  CreateStatBlockRequest,
  InviteExpiry,
  MeResponse,
  ProviderCredential,
  RecordType,
  UpdateMeRequest,
  UpdateRecordRequest,
  UpdateStatBlockRequest,
} from '@stagehand/shared';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  acceptInvite,
  assignCharacter,
  createCampaign,
  createCharacter,
  createInvite,
  createRecord,
  createStatBlock,
  deleteAnthropicKey,
  deleteCharacter,
  deleteRecord,
  deleteStatBlock,
  fetchBacklinks,
  fetchCampaign,
  fetchCampaigns,
  fetchCharacters,
  fetchCharacterSheet,
  fetchInvitePreview,
  fetchInvites,
  fetchMe,
  fetchMembers,
  fetchOwnCharacterSheet,
  fetchProviderCredentials,
  fetchRecord,
  fetchRecords,
  fetchStatBlock,
  fetchStatBlocks,
  patchCharacterSheet,
  patchRecord,
  patchStatBlock,
  removeMember,
  renameCampaign,
  revokeInvite,
  saveAnthropicKey,
  setCampaignArchived,
  updateMe,
  type RecordListFilter,
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

const CREDENTIALS_KEY = ['credentials'] as const;

/** The user's stored AI provider keys (last four characters only, never the key). */
export function useProviderCredentials() {
  return useQuery({ queryKey: CREDENTIALS_KEY, queryFn: fetchProviderCredentials });
}

export function useSaveAnthropicKey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (apiKey: string) => saveAnthropicKey(apiKey),
    onSuccess: (saved: ProviderCredential) => {
      queryClient.setQueryData<ProviderCredential[]>(CREDENTIALS_KEY, (current = []) => [
        ...current.filter((credential) => credential.provider !== saved.provider),
        saved,
      ]);
    },
  });
}

export function useDeleteAnthropicKey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteAnthropicKey,
    onSuccess: () => {
      queryClient.setQueryData<ProviderCredential[]>(CREDENTIALS_KEY, (current = []) =>
        current.filter((credential) => credential.provider !== 'anthropic'),
      );
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

type CampaignPart = 'members' | 'characters' | 'invites' | 'records' | 'stat-blocks';
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

/**
 * One record's key says `'record'`, not `'records'`, so refetching the lists after a save
 * never refetches the record being edited: its cache is written from the save's response.
 */
const recordKey = (campaignId: string, recordId: string) =>
  [...CAMPAIGNS_KEY, campaignId, 'record', recordId] as const;

/** Record summaries, optionally of one type. GM only: pass `enabled: false` for players. */
export function useRecords(campaignId: string, type: RecordType | undefined, enabled: boolean) {
  return useQuery({
    queryKey: [...partKey(campaignId, 'records'), type ?? 'all'],
    queryFn: () => fetchRecords(campaignId, type === undefined ? {} : { type }),
    enabled,
  });
}

/**
 * Records matching a search and filters (F1.6b, D-25), best match first. While a new
 * search is on its way, the previous results stay. Refetched with the other record lists
 * after any record change. GM only: pass `enabled: false` for players.
 */
export function useRecordSearch(campaignId: string, filter: RecordListFilter, enabled: boolean) {
  return useQuery({
    queryKey: [...partKey(campaignId, 'records'), 'search', filter],
    queryFn: () => fetchRecords(campaignId, filter),
    placeholderData: keepPreviousData,
    enabled,
  });
}

/** One record with every field (`null` when not found). GM only. */
export function useRecord(campaignId: string, recordId: string, enabled: boolean) {
  return useQuery({
    queryKey: recordKey(campaignId, recordId),
    queryFn: () => fetchRecord(campaignId, recordId),
    enabled,
  });
}

export function useCreateRecord(campaignId: string) {
  const queryClient = useQueryClient();
  const refetchLists = useRefetch(campaignId, 'records');
  return useMutation({
    mutationFn: (input: CreateRecordRequest) => createRecord(campaignId, input),
    onSuccess: (record) => {
      queryClient.setQueryData(recordKey(campaignId, record.id), record);
      refetchLists();
    },
  });
}

const backlinksPrefix = (campaignId: string) =>
  [...CAMPAIGNS_KEY, campaignId, 'backlinks'] as const;

/** Everything pointing at a record (D-24; `null` when not found). GM only. */
export function useBacklinks(campaignId: string, recordId: string, enabled: boolean) {
  return useQuery({
    queryKey: [...backlinksPrefix(campaignId), recordId],
    queryFn: () => fetchBacklinks(campaignId, recordId),
    enabled,
  });
}

/**
 * Marks every cached backlinks list stale without refetching it: an edit here (a link, a
 * mention, a rename) can change another record's backlinks, which refetch when that page
 * opens. The open record's own backlinks never change from its own edits.
 */
function useStaleBacklinks(campaignId: string) {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({
      queryKey: backlinksPrefix(campaignId),
      refetchType: 'none',
    });
  };
}

/**
 * Saves part of a record; the response becomes the cached record. Linking a stat block
 * also refreshes the stat blocks, whose "used by" lists changed. Other records' backlinks
 * are marked stale, and after a rename so are other cached records (their links show it).
 */
export function usePatchRecord(campaignId: string, recordId: string) {
  const queryClient = useQueryClient();
  const refetchLists = useRefetch(campaignId, 'records');
  const refetchStatBlocks = useRefetchStatBlocks(campaignId);
  const staleBacklinks = useStaleBacklinks(campaignId);
  return useMutation({
    mutationFn: ({ patch, keepalive }: { patch: UpdateRecordRequest; keepalive?: boolean }) =>
      patchRecord(campaignId, recordId, patch, { keepalive }),
    onSuccess: (record, { patch }) => {
      queryClient.setQueryData(recordKey(campaignId, recordId), record);
      refetchLists();
      staleBacklinks();
      if (patch.statBlockId !== undefined) refetchStatBlocks();
      if (patch.name !== undefined) {
        void queryClient.invalidateQueries({
          queryKey: [...CAMPAIGNS_KEY, campaignId, 'record'],
          predicate: (query) => query.queryKey[3] !== recordId,
          refetchType: 'none',
        });
      }
    },
  });
}

/** Which shape of a sheet is cached: the GM's full sheet or a player's own view. */
type SheetView = 'gm' | 'player';

/** Like `recordKey`: singular, so refetching the PC lists never refetches the open sheet. */
const characterKey = (campaignId: string, characterId: string, view: SheetView) =>
  [...CAMPAIGNS_KEY, campaignId, 'character', characterId, view] as const;

/** A PC's full sheet (`null` when not found). GM only: pass `enabled: false` for players. */
export function useCharacterSheet(campaignId: string, characterId: string, enabled: boolean) {
  return useQuery({
    queryKey: characterKey(campaignId, characterId, 'gm'),
    queryFn: () => fetchCharacterSheet(campaignId, characterId),
    enabled,
  });
}

/** The signed-in player's own PC (`null` for any other PC). Players only. */
export function useOwnCharacterSheet(campaignId: string, characterId: string, enabled: boolean) {
  return useQuery({
    queryKey: characterKey(campaignId, characterId, 'player'),
    queryFn: () => fetchOwnCharacterSheet(campaignId, characterId),
    enabled,
  });
}

/** Saves part of a sheet; the response becomes the cached sheet. A rename shows in the lists. */
export function usePatchCharacter(campaignId: string, characterId: string) {
  const queryClient = useQueryClient();
  const refetchLists = useRefetch(campaignId, 'characters', 'members');
  const staleBacklinks = useStaleBacklinks(campaignId);
  return useMutation({
    mutationFn: ({ patch, keepalive }: { patch: CharacterSheetPatch; keepalive?: boolean }) =>
      patchCharacterSheet(campaignId, characterId, patch, { keepalive }),
    onSuccess: (sheet) => {
      queryClient.setQueryData(characterKey(campaignId, characterId, 'gm'), sheet);
      refetchLists();
      // Items list the PCs carrying them.
      staleBacklinks();
    },
  });
}

export function useDeleteCharacter(campaignId: string) {
  const queryClient = useQueryClient();
  const refetchLists = useRefetch(campaignId, 'characters', 'members');
  return useMutation({
    mutationFn: (characterId: string) => deleteCharacter(campaignId, characterId),
    onSuccess: (_result, characterId) => {
      queryClient.removeQueries({
        queryKey: [...CAMPAIGNS_KEY, campaignId, 'character', characterId],
      });
      refetchLists();
    },
  });
}

const statBlockKey = (campaignId: string, statBlockId: string) =>
  [...CAMPAIGNS_KEY, campaignId, 'stat-block', statBlockId] as const;

/** Refetches the stat block list and every cached stat block (their "used by" lists). */
function useRefetchStatBlocks(campaignId: string) {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: partKey(campaignId, 'stat-blocks') });
    void queryClient.invalidateQueries({ queryKey: [...CAMPAIGNS_KEY, campaignId, 'stat-block'] });
  };
}

/** Stat block summaries. GM only: pass `enabled: false` for players. */
export function useStatBlocks(campaignId: string, enabled: boolean) {
  return useQuery({
    queryKey: partKey(campaignId, 'stat-blocks'),
    queryFn: () => fetchStatBlocks(campaignId),
    enabled,
  });
}

/** One stat block (`null` when not found). GM only. */
export function useStatBlock(campaignId: string, statBlockId: string, enabled: boolean) {
  return useQuery({
    queryKey: statBlockKey(campaignId, statBlockId),
    queryFn: () => fetchStatBlock(campaignId, statBlockId),
    enabled,
  });
}

export function useCreateStatBlock(campaignId: string) {
  const queryClient = useQueryClient();
  const refetchList = useRefetch(campaignId, 'stat-blocks');
  return useMutation({
    mutationFn: (input: CreateStatBlockRequest) => createStatBlock(campaignId, input),
    onSuccess: (statBlock) => {
      queryClient.setQueryData(statBlockKey(campaignId, statBlock.id), statBlock);
      refetchList();
    },
  });
}

/** Saves part of a stat block; the response becomes the cached stat block. */
export function usePatchStatBlock(campaignId: string, statBlockId: string) {
  const queryClient = useQueryClient();
  const refetchList = useRefetch(campaignId, 'stat-blocks');
  return useMutation({
    mutationFn: ({ patch, keepalive }: { patch: UpdateStatBlockRequest; keepalive?: boolean }) =>
      patchStatBlock(campaignId, statBlockId, patch, { keepalive }),
    onSuccess: (statBlock) => {
      queryClient.setQueryData(statBlockKey(campaignId, statBlockId), statBlock);
      refetchList();
    },
  });
}

/** Deletes a stat block. Its NPCs are unlinked, so cached records are refetched too. */
export function useDeleteStatBlock(campaignId: string) {
  const queryClient = useQueryClient();
  const refetchList = useRefetch(campaignId, 'stat-blocks');
  return useMutation({
    mutationFn: (statBlockId: string) => deleteStatBlock(campaignId, statBlockId),
    onSuccess: (_result, statBlockId) => {
      queryClient.removeQueries({ queryKey: statBlockKey(campaignId, statBlockId) });
      void queryClient.invalidateQueries({ queryKey: [...CAMPAIGNS_KEY, campaignId, 'record'] });
      refetchList();
    },
  });
}

/**
 * Deletes a record. Its links to and from other records go too, and an Item leaves the PC
 * inventories carrying it (D-24), so cached records, backlinks and sheets are refetched.
 */
export function useDeleteRecord(campaignId: string) {
  const queryClient = useQueryClient();
  const refetchLists = useRefetch(campaignId, 'records');
  return useMutation({
    mutationFn: (recordId: string) => deleteRecord(campaignId, recordId),
    onSuccess: (_result, recordId) => {
      queryClient.removeQueries({ queryKey: recordKey(campaignId, recordId) });
      queryClient.removeQueries({ queryKey: [...backlinksPrefix(campaignId), recordId] });
      for (const part of ['record', 'backlinks', 'character'] as const) {
        void queryClient.invalidateQueries({ queryKey: [...CAMPAIGNS_KEY, campaignId, part] });
      }
      refetchLists();
    },
  });
}
