import type {
  Campaign,
  CampaignRecord,
  CharacterSheet,
  CharacterSheetPatch,
  CreateCharacterRequest,
  CreateRecordRequest,
  CreateStatBlockRequest,
  GenerateVisualRequest,
  ImportDetail,
  ImportSummary,
  PatchProposalRequest,
  StartImportRequest,
  InviteExpiry,
  MeResponse,
  Provider,
  ProviderCredential,
  RecordType,
  UpdateMeRequest,
  UpdateRecordRequest,
  UpdateStatBlockRequest,
  VisualsResponse,
} from '@stagehand/shared';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  acceptAllProposals,
  acceptInvite,
  assignCharacter,
  answerImportQuestions,
  commitImport,
  createCampaign,
  createCharacter,
  createInvite,
  createRecord,
  createStatBlock,
  deleteProviderKey,
  deleteCharacter,
  deleteRecord,
  deleteStatBlock,
  discardImport,
  estimateImport,
  fetchBacklinks,
  fetchCampaign,
  fetchVisuals,
  generateVisual,
  chooseVisual,
  type VisualOwnerRef,
  fetchCampaigns,
  fetchCharacters,
  fetchCharacterSheet,
  fetchImport,
  fetchImports,
  generateImportRecords,
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
  fetchUsage,
  patchCharacterSheet,
  patchProposal,
  patchRecord,
  patchStatBlock,
  removeMember,
  renameCampaign,
  revokeInvite,
  saveProviderKey,
  setCampaignArchived,
  retryImport,
  startImport,
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

type CampaignPart = 'members' | 'characters' | 'invites' | 'records' | 'stat-blocks' | 'imports';
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
 * A record's or PC's tries at a visual (F2.3), newest first. Polled while one is still being
 * made, so the card fills in by itself, also after a reload. GM only.
 */
export function useVisuals(campaignId: string, owner: VisualOwnerRef, enabled: boolean) {
  return useQuery({
    queryKey: visualsKey(campaignId, owner),
    queryFn: () => fetchVisuals(campaignId, owner),
    enabled,
    refetchInterval: (query) =>
      query.state.data?.assets.some((asset) => asset.status === 'generating') === true
        ? visualPolling.intervalMs
        : false,
  });
}

/** Starts an image; the `generating` try shows at once, then polling takes over. */
export function useGenerateVisual(campaignId: string, owner: VisualOwnerRef) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: GenerateVisualRequest) => generateVisual(campaignId, owner, input),
    onSuccess: (asset) => {
      queryClient.setQueryData<VisualsResponse>(visualsKey(campaignId, owner), (current) =>
        current === undefined ? current : { ...current, assets: [asset, ...current.assets] },
      );
      void queryClient.invalidateQueries({ queryKey: visualsKey(campaignId, owner) });
    },
  });
}

/**
 * "Use this one": the answer replaces the cached tries, and the open record or sheet learns
 * its new visual without a refetch (which would race the editor's own saves).
 */
export function useChooseVisual(campaignId: string, owner: VisualOwnerRef) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (assetId: string) => chooseVisual(campaignId, owner, assetId),
    onSuccess: (visuals) => {
      queryClient.setQueryData(visualsKey(campaignId, owner), visuals);
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
