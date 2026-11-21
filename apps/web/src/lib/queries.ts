import type {
  AssetSummary,
  Campaign,
  CampaignRecord,
  CharacterSheet,
  CharacterSheetPatch,
  CreateCharacterRequest,
  CreateEntryRequest,
  CreateRecordRequest,
  CreateSceneRequest,
  CreateStatBlockRequest,
  GenerateVisualRequest,
  ImportDetail,
  ImportSummary,
  PatchProposalRequest,
  StartImportRequest,
  InviteExpiry,
  JournalRecordListQuery,
  MeResponse,
  PlaySession,
  Provider,
  ProviderCredential,
  RecordType,
  Scene,
  SceneObjectInput,
  UpdateEntryRequest,
  UpdateMeRequest,
  UpdateRecordRequest,
  UpdateSceneRequest,
  UpdateStatBlockRequest,
  VisualsResponse,
  CreateDomainCardRequest,
  CreateDomainRequest,
  UpdateDomainCardRequest,
  UpdateDomainRequest,
  CreateArmorRequest,
  CreateWeaponRequest,
  UpdateArmorRequest,
  UpdateWeaponRequest,
} from '@stagehand/shared';
import {
  keepPreviousData,
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';

import {
  acceptAllProposals,
  acceptInvite,
  assignCharacter,
  answerImportQuestions,
  commitImport,
  createCampaign,
  createCharacter,
  createEntry,
  createInvite,
  createNote,
  createRecord,
  createScene,
  createStatBlock,
  deleteProviderKey,
  deleteCharacter,
  deleteEntry,
  deleteNote,
  deleteRecord,
  deleteScene,
  deleteStatBlock,
  discardImport,
  endPlaySession,
  estimateImport,
  fetchBacklinks,
  fetchCampaign,
  fetchVisuals,
  generateVisual,
  reviseVisual,
  chooseVisual,
  discardVisual,
  type VisualOwnerRef,
  fetchCampaigns,
  fetchCharacters,
  fetchCharacterSheet,
  fetchEntries,
  fetchEntry,
  fetchImport,
  fetchImports,
  generateImportRecords,
  fetchInvitePreview,
  fetchInvites,
  fetchJournalRecord,
  fetchJournalRecords,
  fetchMe,
  fetchMembers,
  fetchNotes,
  fetchOwnCharacterSheet,
  fetchPlaySession,
  fetchSessionLog,
  fetchProviderCredentials,
  fetchRecord,
  fetchRecords,
  fetchScene,
  fetchScenes,
  fetchStageRecords,
  fetchStatBlock,
  fetchStatBlocks,
  fetchUsage,
  patchCharacterSheet,
  patchProposal,
  patchRecord,
  patchScene,
  patchStatBlock,
  removeMember,
  renameCampaign,
  revokeInvite,
  saveProviderKey,
  saveSceneObjects,
  setCampaignArchived,
  setRecordRevealed,
  retryImport,
  startImport,
  startPlaySession,
  updateEntry,
  updateMe,
  updateNote,
  type NoteSubjectRef,
  type RecordListFilter,
  createDomain,
  createDomainCard,
  deleteDomain,
  deleteDomainCard,
  fetchDomain,
  fetchDomainCard,
  fetchDomainCards,
  fetchDomains,
  patchDomain,
  patchDomainCard,
  createArmor,
  createWeapon,
  deleteArmor,
  deleteWeapon,
  fetchArmor,
  fetchArmorList,
  fetchWeapon,
  fetchWeapons,
  patchArmor,
  patchWeapon,
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

export function useSaveProviderKey(provider: Provider) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (apiKey: string) => saveProviderKey(provider, apiKey),
    onSuccess: (saved: ProviderCredential) => {
      queryClient.setQueryData<ProviderCredential[]>(CREDENTIALS_KEY, (current = []) => [
        ...current.filter((credential) => credential.provider !== saved.provider),
        saved,
      ]);
    },
  });
}

export function useDeleteProviderKey(provider: Provider) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => deleteProviderKey(provider),
    onSuccess: () => {
      queryClient.setQueryData<ProviderCredential[]>(CREDENTIALS_KEY, (current = []) =>
        current.filter((credential) => credential.provider !== provider),
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

type CampaignPart =
  | 'members'
  | 'characters'
  | 'invites'
  | 'records'
  | 'stat-blocks'
  | 'imports'
  | 'scenes'
  | 'stage-records'
  | 'play-session'
  | 'play-session-log'
  | 'journal'
  | 'gameplay';
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
  const refetchStage = useRefetch(campaignId, 'scenes', 'stage-records');
  const refetchJournal = useRefetch(campaignId, 'journal');
  return useMutation({
    mutationFn: ({ patch, keepalive }: { patch: UpdateRecordRequest; keepalive?: boolean }) =>
      patchRecord(campaignId, recordId, patch, { keepalive }),
    onSuccess: (record, { patch }) => {
      queryClient.setQueryData(recordKey(campaignId, recordId), record);
      refetchLists();
      staleBacklinks();
      if (record.revealedAt !== null) refetchJournal();
      if (patch.statBlockId !== undefined) refetchStatBlocks();
      if (patch.name !== undefined) {
        // Scenes and the builder's tray show record names.
        refetchStage();
        void queryClient.invalidateQueries({
          queryKey: [...CAMPAIGNS_KEY, campaignId, 'record'],
          predicate: (query) => query.queryKey[3] !== recordId,
          refetchType: 'none',
        });
      }
    },
  });
}

/**
 * Reveals a record to players, or takes it back (F3.4). The answer becomes the cached record,
 * and the record lists, which show what is revealed, are refetched. During a session the
 * server sends the stage again by itself.
 */
export function useRevealRecord(campaignId: string) {
  const queryClient = useQueryClient();
  const refetchLists = useRefetch(campaignId, 'records', 'journal');
  return useMutation({
    mutationFn: ({ recordId, revealed }: { recordId: string; revealed: boolean }) =>
      setRecordRevealed(campaignId, recordId, revealed),
    onSuccess: (record) => {
      queryClient.setQueryData(recordKey(campaignId, record.id), record);
      refetchLists();
    },
  });
}

/** Which shape of a sheet is cached: the GM's full sheet or a player's own view. */
type SheetView = 'gm' | 'player';

/** Like `recordKey`: singular, so refetching the PC lists never refetches the open sheet. */
const characterKey = (campaignId: string, characterId: string, view: SheetView) =>
  [...CAMPAIGNS_KEY, campaignId, 'character', characterId, view] as const;

/** Every view of a PC's sheet: read again when the live room says it changed (F3.6). */
export const characterSheetKey = (campaignId: string, characterId: string) =>
  [...CAMPAIGNS_KEY, campaignId, 'character', characterId] as const;

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

/** Gameplay records (F4.3): every member reads them; one key holds them all. */
const gameplayKey = (campaignId: string, ...rest: string[]) =>
  [...partKey(campaignId, 'gameplay'), ...rest] as const;

/** Refetches every gameplay list and domain, but not `except`, the card or domain just saved. */
function useRefetchGameplay(campaignId: string) {
  const queryClient = useQueryClient();
  return (except?: readonly unknown[]) => {
    void queryClient.invalidateQueries({
      queryKey: gameplayKey(campaignId),
      predicate: (query) =>
        except === undefined || JSON.stringify(query.queryKey) !== JSON.stringify(except),
    });
  };
}

/** The campaign's domains, with their card counts. Any member. */
export function useDomains(campaignId: string) {
  return useQuery({
    queryKey: gameplayKey(campaignId, 'domains'),
    queryFn: () => fetchDomains(campaignId),
  });
}

/** A domain with its cards (`null` when not found). */
export function useDomain(campaignId: string, domainId: string) {
  return useQuery({
    queryKey: gameplayKey(campaignId, 'domain', domainId),
    queryFn: () => fetchDomain(campaignId, domainId),
  });
}

/** Every domain card of the campaign. */
export function useDomainCards(campaignId: string) {
  return useQuery({
    queryKey: gameplayKey(campaignId, 'cards'),
    queryFn: () => fetchDomainCards(campaignId),
  });
}

/** A domain card (`null` when not found). */
export function useDomainCard(campaignId: string, cardId: string) {
  return useQuery({
    queryKey: gameplayKey(campaignId, 'card', cardId),
    queryFn: () => fetchDomainCard(campaignId, cardId),
  });
}

export function useCreateDomain(campaignId: string) {
  const refetch = useRefetchGameplay(campaignId);
  return useMutation({
    mutationFn: (input: CreateDomainRequest) => createDomain(campaignId, input),
    onSuccess: () => {
      refetch();
    },
  });
}

/** Saves part of a domain; the response becomes the cached domain. */
export function usePatchDomain(campaignId: string, domainId: string) {
  const queryClient = useQueryClient();
  const refetch = useRefetchGameplay(campaignId);
  const key = gameplayKey(campaignId, 'domain', domainId);
  return useMutation({
    mutationFn: ({ patch, keepalive }: { patch: UpdateDomainRequest; keepalive?: boolean }) =>
      patchDomain(campaignId, domainId, patch, { keepalive }),
    onSuccess: (domain) => {
      queryClient.setQueryData(key, domain);
      refetch(key);
    },
  });
}

/** Deletes a domain no card uses; the refusal names the cards. */
export function useDeleteDomain(campaignId: string) {
  const queryClient = useQueryClient();
  const refetch = useRefetchGameplay(campaignId);
  return useMutation({
    mutationFn: (domainId: string) => deleteDomain(campaignId, domainId),
    onSuccess: (_result, domainId) => {
      queryClient.removeQueries({ queryKey: gameplayKey(campaignId, 'domain', domainId) });
      refetch();
    },
  });
}

export function useCreateDomainCard(campaignId: string) {
  const queryClient = useQueryClient();
  const refetch = useRefetchGameplay(campaignId);
  return useMutation({
    mutationFn: (input: CreateDomainCardRequest) => createDomainCard(campaignId, input),
    onSuccess: (card) => {
      queryClient.setQueryData(gameplayKey(campaignId, 'card', card.id), card);
      refetch(gameplayKey(campaignId, 'card', card.id));
    },
  });
}

/** Saves part of a domain card; the response becomes the cached card. */
export function usePatchDomainCard(campaignId: string, cardId: string) {
  const queryClient = useQueryClient();
  const refetch = useRefetchGameplay(campaignId);
  const key = gameplayKey(campaignId, 'card', cardId);
  return useMutation({
    mutationFn: ({ patch, keepalive }: { patch: UpdateDomainCardRequest; keepalive?: boolean }) =>
      patchDomainCard(campaignId, cardId, patch, { keepalive }),
    onSuccess: (card) => {
      queryClient.setQueryData(key, card);
      refetch(key);
    },
  });
}

export function useDeleteDomainCard(campaignId: string) {
  const queryClient = useQueryClient();
  const refetch = useRefetchGameplay(campaignId);
  return useMutation({
    mutationFn: (cardId: string) => deleteDomainCard(campaignId, cardId),
    onSuccess: (_result, cardId) => {
      queryClient.removeQueries({ queryKey: gameplayKey(campaignId, 'card', cardId) });
      refetch();
    },
  });
}

/** The campaign's weapons (F4.4), by tier, slot and name. Any member. */
export function useWeapons(campaignId: string) {
  return useQuery({
    queryKey: gameplayKey(campaignId, 'weapons'),
    queryFn: () => fetchWeapons(campaignId),
  });
}

/** A weapon (`null` when not found). */
export function useWeapon(campaignId: string, weaponId: string) {
  return useQuery({
    queryKey: gameplayKey(campaignId, 'weapon', weaponId),
    queryFn: () => fetchWeapon(campaignId, weaponId),
  });
}

export function useCreateWeapon(campaignId: string) {
  const queryClient = useQueryClient();
  const refetch = useRefetchGameplay(campaignId);
  return useMutation({
    mutationFn: (input: CreateWeaponRequest) => createWeapon(campaignId, input),
    onSuccess: (weapon) => {
      queryClient.setQueryData(gameplayKey(campaignId, 'weapon', weapon.id), weapon);
      refetch(gameplayKey(campaignId, 'weapon', weapon.id));
    },
  });
}

/** Saves part of a weapon; the response becomes the cached weapon. */
export function usePatchWeapon(campaignId: string, weaponId: string) {
  const queryClient = useQueryClient();
  const refetch = useRefetchGameplay(campaignId);
  const key = gameplayKey(campaignId, 'weapon', weaponId);
  return useMutation({
    mutationFn: ({ patch, keepalive }: { patch: UpdateWeaponRequest; keepalive?: boolean }) =>
      patchWeapon(campaignId, weaponId, patch, { keepalive }),
    onSuccess: (weapon) => {
      queryClient.setQueryData(key, weapon);
      refetch(key);
    },
  });
}

export function useDeleteWeapon(campaignId: string) {
  const queryClient = useQueryClient();
  const refetch = useRefetchGameplay(campaignId);
  return useMutation({
    mutationFn: (weaponId: string) => deleteWeapon(campaignId, weaponId),
    onSuccess: (_result, weaponId) => {
      queryClient.removeQueries({ queryKey: gameplayKey(campaignId, 'weapon', weaponId) });
      refetch();
    },
  });
}

/** The campaign's armor (F4.4), by tier and name. Any member. */
export function useArmorList(campaignId: string) {
  return useQuery({
    queryKey: gameplayKey(campaignId, 'armor-list'),
    queryFn: () => fetchArmorList(campaignId),
  });
}

/** A piece of armor (`null` when not found). */
export function useArmor(campaignId: string, armorId: string) {
  return useQuery({
    queryKey: gameplayKey(campaignId, 'armor', armorId),
    queryFn: () => fetchArmor(campaignId, armorId),
  });
}

export function useCreateArmor(campaignId: string) {
  const queryClient = useQueryClient();
  const refetch = useRefetchGameplay(campaignId);
  return useMutation({
    mutationFn: (input: CreateArmorRequest) => createArmor(campaignId, input),
    onSuccess: (piece) => {
      queryClient.setQueryData(gameplayKey(campaignId, 'armor', piece.id), piece);
      refetch(gameplayKey(campaignId, 'armor', piece.id));
    },
  });
}

/** Saves part of a piece of armor; the response becomes the cached piece. */
export function usePatchArmor(campaignId: string, armorId: string) {
  const queryClient = useQueryClient();
  const refetch = useRefetchGameplay(campaignId);
  const key = gameplayKey(campaignId, 'armor', armorId);
  return useMutation({
    mutationFn: ({ patch, keepalive }: { patch: UpdateArmorRequest; keepalive?: boolean }) =>
      patchArmor(campaignId, armorId, patch, { keepalive }),
    onSuccess: (piece) => {
      queryClient.setQueryData(key, piece);
      refetch(key);
    },
  });
}

export function useDeleteArmor(campaignId: string) {
  const queryClient = useQueryClient();
  const refetch = useRefetchGameplay(campaignId);
  return useMutation({
    mutationFn: (armorId: string) => deleteArmor(campaignId, armorId),
    onSuccess: (_result, armorId) => {
      queryClient.removeQueries({ queryKey: gameplayKey(campaignId, 'armor', armorId) });
      refetch();
    },
  });
}

/**
 * Deletes a record. Its links to and from other records go too, and an Item leaves the PC
 * inventories carrying it (D-24), so cached records, backlinks and sheets are refetched.
 */
export function useDeleteRecord(campaignId: string) {
  const queryClient = useQueryClient();
  // A deleted record leaves every scene it was placed in.
  const refetchLists = useRefetch(campaignId, 'records', 'scenes', 'stage-records', 'journal');
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

const USAGE_KEY = ['usage'] as const;

/** How often a running import is polled. Tests shorten it. */
export const importPolling = { intervalMs: 2000 };

/** Like `recordKey`: singular, so refetching the import list never refetches the open import. */
const importKey = (campaignId: string, importId: string) =>
  [...CAMPAIGNS_KEY, campaignId, 'import', importId] as const;

/** The campaign's imports, newest first. GM only: pass `enabled: false` for players. */
export function useImports(campaignId: string, enabled: boolean) {
  return useQuery({
    queryKey: partKey(campaignId, 'imports'),
    queryFn: () => fetchImports(campaignId),
    enabled,
  });
}

/**
 * One import with its proposals (`null` when not found). Polled while the model is still
 * working, so the review screen fills in by itself, also after a reload. GM only.
 */
export function useImport(campaignId: string, importId: string, enabled: boolean) {
  return useQuery({
    queryKey: importKey(campaignId, importId),
    queryFn: () => fetchImport(campaignId, importId),
    enabled,
    refetchInterval: (query) =>
      query.state.data?.status === 'running' ? importPolling.intervalMs : false,
  });
}

/** The free cost estimate of an import that hasn't been sent. */
export function useEstimateImport(campaignId: string) {
  return useMutation({
    mutationFn: (input: StartImportRequest) => estimateImport(campaignId, input),
  });
}

/** Sends the notes to the model; resolves to the `running` import. */
export function useStartImport(campaignId: string) {
  const queryClient = useQueryClient();
  const refetchList = useRefetch(campaignId, 'imports');
  return useMutation({
    mutationFn: (input: StartImportRequest) => startImport(campaignId, input),
    onSuccess: () => {
      refetchList();
      void queryClient.invalidateQueries({ queryKey: USAGE_KEY });
    },
  });
}

/** Writes a fresher summary of an import into its cached detail. */
function useImportSummarySaved(campaignId: string) {
  const queryClient = useQueryClient();
  const refetchList = useRefetch(campaignId, 'imports');
  return (summary: ImportSummary) => {
    queryClient.setQueryData<ImportDetail | null>(importKey(campaignId, summary.id), (current) =>
      current == null ? current : { ...current, ...summary },
    );
    refetchList();
  };
}

/** Accepts, rejects or edits one proposal; the answer replaces it in the cached import. */
export function usePatchProposal(campaignId: string, importId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ proposalId, patch }: { proposalId: string; patch: PatchProposalRequest }) =>
      patchProposal(campaignId, importId, proposalId, patch),
    onSuccess: ({ proposal, refs }) => {
      queryClient.setQueryData<ImportDetail | null>(importKey(campaignId, importId), (current) =>
        current == null
          ? current
          : {
              ...current,
              proposals: current.proposals.map((p) => (p.id === proposal.id ? proposal : p)),
              refs: { ...current.refs, ...refs },
            },
      );
    },
  });
}

export function useAcceptAllProposals(campaignId: string, importId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => acceptAllProposals(campaignId, importId),
    onSuccess: (detail) => {
      queryClient.setQueryData(importKey(campaignId, importId), detail);
    },
  });
}

/**
 * Saves the accepted proposals. New and changed records, their links and backlinks all
 * change, so every cached record, list and backlinks list is refetched, as is usage.
 */
export function useCommitImport(campaignId: string, importId: string) {
  const queryClient = useQueryClient();
  const summarySaved = useImportSummarySaved(campaignId);
  return useMutation({
    mutationFn: () => commitImport(campaignId, importId),
    onSuccess: (result) => {
      summarySaved(result.import);
      for (const part of ['records', 'record', 'backlinks', 'import'] as const) {
        void queryClient.invalidateQueries({ queryKey: [...CAMPAIGNS_KEY, campaignId, part] });
      }
      void queryClient.invalidateQueries({ queryKey: USAGE_KEY });
    },
  });
}

/**
 * Starts the next step of an import (D-30): answering the questions, writing the records, or
 * trying a failed step again. The import is `running` again, so the page polls it.
 */
function useImportStep<Input>(
  campaignId: string,
  importId: string,
  start: (input: Input) => Promise<ImportSummary>,
) {
  const queryClient = useQueryClient();
  const summarySaved = useImportSummarySaved(campaignId);
  return useMutation({
    mutationFn: start,
    onSuccess: (summary) => {
      summarySaved(summary);
      void queryClient.invalidateQueries({ queryKey: importKey(campaignId, importId) });
      void queryClient.invalidateQueries({ queryKey: USAGE_KEY });
    },
  });
}

export function useAnswerImportQuestions(campaignId: string, importId: string) {
  return useImportStep(campaignId, importId, (answer: string) =>
    answerImportQuestions(campaignId, importId, { answer }),
  );
}

export function useGenerateImportRecords(campaignId: string, importId: string) {
  return useImportStep(campaignId, importId, (answer: string) =>
    generateImportRecords(campaignId, importId, answer.trim() === '' ? {} : { answer }),
  );
}

export function useRetryImport(campaignId: string, importId: string) {
  return useImportStep(campaignId, importId, () => retryImport(campaignId, importId));
}

export function useDiscardImport(campaignId: string, importId: string) {
  return useMutation({
    mutationFn: () => discardImport(campaignId, importId),
    onSuccess: useImportSummarySaved(campaignId),
  });
}

/** The signed-in GM's imports and token usage, for Settings. */
export function useUsage() {
  return useQuery({ queryKey: USAGE_KEY, queryFn: fetchUsage });
}

/** How often a record's or PC's visuals are polled while an image is being made. Tests shorten it. */
export const visualPolling = { intervalMs: 2000 };

const visualsKey = (campaignId: string, owner: VisualOwnerRef) =>
  [
    ...CAMPAIGNS_KEY,
    campaignId,
    'visuals',
    'recordId' in owner ? `record:${owner.recordId}` : `character:${owner.characterId}`,
  ] as const;

/**
 * A record's or PC's image in use and its drafts (F2.3, F2.5). Polled while one is still being
 * made, so the card fills in by itself, also after a reload. GM only.
 */
export function useVisuals(campaignId: string, owner: VisualOwnerRef, enabled: boolean) {
  return useQuery({
    queryKey: visualsKey(campaignId, owner),
    queryFn: () => fetchVisuals(campaignId, owner),
    enabled,
    refetchInterval: (query) =>
      query.state.data?.drafts.some((asset) => asset.status === 'generating') === true
        ? visualPolling.intervalMs
        : false,
  });
}

/** Shows a just-started try at once (starting one dismisses failed tries), then refetches. */
function useAddDraft(campaignId: string, owner: VisualOwnerRef) {
  const queryClient = useQueryClient();
  return (asset: AssetSummary) => {
    queryClient.setQueryData<VisualsResponse>(visualsKey(campaignId, owner), (current) =>
      current === undefined
        ? current
        : {
            ...current,
            drafts: [...current.drafts.filter((draft) => draft.status !== 'failed'), asset],
          },
    );
    void queryClient.invalidateQueries({ queryKey: visualsKey(campaignId, owner) });
  };
}

/** Starts an image; the `generating` try shows at once, then polling takes over. */
export function useGenerateVisual(campaignId: string, owner: VisualOwnerRef) {
  const addDraft = useAddDraft(campaignId, owner);
  return useMutation({
    mutationFn: (input: GenerateVisualRequest) => generateVisual(campaignId, owner, input),
    onSuccess: addDraft,
  });
}

/** Regenerate with notes (F2.5): like `useGenerateVisual`, starting from an existing image. */
export function useReviseVisual(campaignId: string, owner: VisualOwnerRef) {
  const addDraft = useAddDraft(campaignId, owner);
  return useMutation({
    mutationFn: ({ assetId, notes }: { assetId: string; notes: string }) =>
      reviseVisual(campaignId, owner, assetId, notes),
    onSuccess: addDraft,
  });
}

/** Discards a draft (F2.5); the answer replaces the cached visuals. */
export function useDiscardVisual(campaignId: string, owner: VisualOwnerRef) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (assetId: string) => discardVisual(campaignId, owner, assetId),
    onSuccess: (visuals) => {
      queryClient.setQueryData(visualsKey(campaignId, owner), visuals);
    },
  });
}

/**
 * "Use this" / "Replace": the answer replaces the cached visuals, and the open record or sheet learns
 * its new visual without a refetch (which would race the editor's own saves).
 */
export function useChooseVisual(campaignId: string, owner: VisualOwnerRef) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (assetId: string) => chooseVisual(campaignId, owner, assetId),
    onSuccess: (visuals) => {
      queryClient.setQueryData(visualsKey(campaignId, owner), visuals);
      // A record with a new image can be placed in a scene (F3.2).
      void queryClient.invalidateQueries({ queryKey: partKey(campaignId, 'stage-records') });
      const patch = <T extends { visualAssetId: string | null }>(current: T | null | undefined) =>
        current == null ? current : { ...current, visualAssetId: visuals.visualAssetId };
      if ('recordId' in owner) {
        queryClient.setQueryData<CampaignRecord | null>(
          recordKey(campaignId, owner.recordId),
          patch,
        );
      } else {
        queryClient.setQueryData<CharacterSheet | null>(
          characterKey(campaignId, owner.characterId, 'gm'),
          patch,
        );
      }
    },
  });
}

/** Like `recordKey`: singular, so refetching the scene list never refetches the open scene. */
const sceneKey = (campaignId: string, sceneId: string) =>
  [...CAMPAIGNS_KEY, campaignId, 'scene', sceneId] as const;

/** The campaign's scenes, by name (F3.2). GM only: pass `enabled: false` for players. */
export function useScenes(campaignId: string, enabled: boolean) {
  return useQuery({
    queryKey: partKey(campaignId, 'scenes'),
    queryFn: () => fetchScenes(campaignId),
    enabled,
  });
}

/** One scene with its Spot, objects and suggestions (`null` when not found). GM only. */
export function useScene(campaignId: string, sceneId: string, enabled: boolean) {
  return useQuery({
    queryKey: sceneKey(campaignId, sceneId),
    queryFn: () => fetchScene(campaignId, sceneId),
    enabled,
  });
}

/** What the builder's tray offers: placeable records with an image, and every Spot. GM only. */
export function useStageRecords(campaignId: string, enabled: boolean) {
  return useQuery({
    queryKey: partKey(campaignId, 'stage-records'),
    queryFn: () => fetchStageRecords(campaignId),
    enabled,
  });
}

export function useCreateScene(campaignId: string) {
  const queryClient = useQueryClient();
  const refetchList = useRefetch(campaignId, 'scenes');
  return useMutation({
    mutationFn: (input: CreateSceneRequest) => createScene(campaignId, input),
    onSuccess: (scene) => {
      queryClient.setQueryData(sceneKey(campaignId, scene.id), scene);
      refetchList();
    },
  });
}

/**
 * Renames a scene or changes its Spot. The answer's name, Spot and suggestions go into the
 * cached scene; its objects stay as cached, since the builder saves those separately and an
 * answer here could be older than its last save.
 */
export function usePatchScene(campaignId: string) {
  const queryClient = useQueryClient();
  const refetchList = useRefetch(campaignId, 'scenes');
  return useMutation({
    mutationFn: ({ sceneId, patch }: { sceneId: string; patch: UpdateSceneRequest }) =>
      patchScene(campaignId, sceneId, patch),
    onSuccess: (scene) => {
      queryClient.setQueryData<Scene | null>(sceneKey(campaignId, scene.id), (current) =>
        current == null ? scene : { ...scene, objects: current.objects },
      );
      refetchList();
    },
  });
}

export function useDeleteScene(campaignId: string) {
  const queryClient = useQueryClient();
  const refetchList = useRefetch(campaignId, 'scenes');
  return useMutation({
    mutationFn: (sceneId: string) => deleteScene(campaignId, sceneId),
    onSuccess: (_result, sceneId) => {
      queryClient.removeQueries({ queryKey: sceneKey(campaignId, sceneId) });
      refetchList();
    },
  });
}

/**
 * Saves a scene's whole list of objects (D-49). Only the objects of the answer go into the
 * cached scene: its name and Spot are saved separately (see `usePatchScene`).
 */
export function useSaveSceneObjects(campaignId: string, sceneId: string) {
  const queryClient = useQueryClient();
  const refetchList = useRefetch(campaignId, 'scenes');
  return useMutation({
    mutationFn: ({ objects, keepalive }: { objects: SceneObjectInput[]; keepalive?: boolean }) =>
      saveSceneObjects(campaignId, sceneId, objects, { keepalive }),
    onSuccess: (scene) => {
      queryClient.setQueryData<Scene | null>(sceneKey(campaignId, sceneId), (current) =>
        current == null
          ? scene
          : { ...current, objects: scene.objects, updatedAt: scene.updatedAt },
      );
      refetchList();
    },
  });
}

/** How often a page that shows whether a session is running asks again. */
const PLAY_SESSION_REFRESH_MS = 10_000;

/**
 * The campaign's running session (F3.3), or null. Asked again every few seconds, so a player
 * looking at the campaign page sees the session appear soon after the GM starts it.
 */
export function usePlaySession(campaignId: string) {
  return useQuery({
    queryKey: partKey(campaignId, 'play-session'),
    queryFn: () => fetchPlaySession(campaignId),
    refetchInterval: PLAY_SESSION_REFRESH_MS,
  });
}

/** Starts a session (or finds the one already running). GM only. */
export function useStartPlaySession(campaignId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => startPlaySession(campaignId),
    onSuccess: (session) => {
      queryClient.setQueryData<PlaySession | null>(partKey(campaignId, 'play-session'), session);
    },
  });
}

/** The running session's log for the GM's desk (F3.6). */
export function useSessionLog(campaignId: string) {
  return useQuery({
    queryKey: sessionLogKey(campaignId),
    queryFn: () => fetchSessionLog(campaignId),
  });
}

/** The key of the session's log: read again when the live room says it grew. */
export const sessionLogKey = (campaignId: string) => partKey(campaignId, 'play-session-log');

/** Ends the running session for everyone. GM only. */
export function useEndPlaySession(campaignId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => endPlaySession(campaignId),
    onSuccess: () => {
      queryClient.setQueryData<PlaySession | null>(partKey(campaignId, 'play-session'), null);
    },
  });
}

/**
 * The running session of each of several campaigns, in the same order (F3.3c): for a list that
 * shows where a session is on. Shares its answers with `usePlaySession`.
 */
export function usePlaySessions(campaignIds: readonly string[]) {
  return useQueries({
    queries: campaignIds.map((campaignId) => ({
      queryKey: partKey(campaignId, 'play-session'),
      queryFn: () => fetchPlaySession(campaignId),
      refetchInterval: PLAY_SESSION_REFRESH_MS,
    })),
  });
}

// --- The player journal (F3.5) ------------------------------------------------------------

/**
 * Everything of one campaign's journal: revealed records, entries and notes. The play room
 * marks it stale when the server says the journal changed (`journal:changed`).
 */
export const journalKey = (campaignId: string) => partKey(campaignId, 'journal');

/** Revealed records, optionally narrowed by type and search. Any member. */
export function useJournalRecords(
  campaignId: string,
  filter: JournalRecordListQuery,
  enabled = true,
) {
  return useQuery({
    queryKey: [...journalKey(campaignId), 'records', filter],
    queryFn: () => fetchJournalRecords(campaignId, filter),
    placeholderData: keepPreviousData,
    enabled,
  });
}

/** A revealed record's public layer (`null` when players don't have it). */
export function useJournalRecord(campaignId: string, recordId: string, enabled = true) {
  return useQuery({
    queryKey: [...journalKey(campaignId), 'record', recordId],
    queryFn: () => fetchJournalRecord(campaignId, recordId),
    enabled,
  });
}

export function useEntries(campaignId: string, enabled = true) {
  return useQuery({
    queryKey: [...journalKey(campaignId), 'entries'],
    queryFn: () => fetchEntries(campaignId),
    enabled,
  });
}

/** One player entry (`null` when it was deleted). */
export function useEntry(campaignId: string, entryId: string, enabled = true) {
  return useQuery({
    queryKey: [...journalKey(campaignId), 'entry', entryId],
    queryFn: () => fetchEntry(campaignId, entryId),
    enabled,
  });
}

/** A record's or entry's notes, newest first (`null` when it is gone or no longer revealed). */
export function useNotes(campaignId: string, subject: NoteSubjectRef, enabled = true) {
  return useQuery({
    queryKey: [...journalKey(campaignId), 'notes', subject],
    queryFn: () => fetchNotes(campaignId, subject),
    enabled,
  });
}

/** Refetches the journal after a change to it. */
function useRefetchJournal(campaignId: string) {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: journalKey(campaignId) });
  };
}

export function useCreateNote(campaignId: string, subject: NoteSubjectRef) {
  return useMutation({
    mutationFn: (body: string) => createNote(campaignId, subject, body),
    onSuccess: useRefetchJournal(campaignId),
  });
}

export function useUpdateNote(campaignId: string) {
  return useMutation({
    mutationFn: ({ noteId, body }: { noteId: string; body: string }) =>
      updateNote(campaignId, noteId, body),
    onSuccess: useRefetchJournal(campaignId),
  });
}

export function useDeleteNote(campaignId: string) {
  return useMutation({
    mutationFn: (noteId: string) => deleteNote(campaignId, noteId),
    onSuccess: useRefetchJournal(campaignId),
  });
}

export function useCreateEntry(campaignId: string) {
  return useMutation({
    mutationFn: (input: CreateEntryRequest) => createEntry(campaignId, input),
    onSuccess: useRefetchJournal(campaignId),
  });
}

export function useUpdateEntry(campaignId: string, entryId: string) {
  return useMutation({
    mutationFn: (patch: UpdateEntryRequest) => updateEntry(campaignId, entryId, patch),
    onSuccess: useRefetchJournal(campaignId),
  });
}

export function useDeleteEntry(campaignId: string) {
  const queryClient = useQueryClient();
  const refetch = useRefetchJournal(campaignId);
  return useMutation({
    mutationFn: (entryId: string) => deleteEntry(campaignId, entryId),
    onSuccess: (_result, entryId) => {
      queryClient.removeQueries({ queryKey: [...journalKey(campaignId), 'entry', entryId] });
      refetch();
    },
  });
}
