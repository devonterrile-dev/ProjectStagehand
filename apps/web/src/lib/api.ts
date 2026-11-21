import {
  acceptInviteResponseSchema,
  assetSummarySchema,
  backlinksResponseSchema,
  campaignListResponseSchema,
  campaignSchema,
  commitImportResponseSchema,
  importDetailSchema,
  importEstimateResponseSchema,
  importListResponseSchema,
  importSummarySchema,
  patchProposalResponseSchema,
  usageResponseSchema,
  characterListResponseSchema,
  characterSchema,
  characterSheetSchema,
  inviteListResponseSchema,
  invitePreviewSchema,
  inviteSchema,
  journalRecordListResponseSchema,
  journalRecordSchema,
  playerEntryListResponseSchema,
  playerEntrySchema,
  playerNoteListResponseSchema,
  playerNoteSchema,
  memberListResponseSchema,
  meResponseSchema,
  playerCharacterSheetSchema,
  playSessionResponseSchema,
  sessionLogResponseSchema,
  providerCredentialSchema,
  providerCredentialsResponseSchema,
  recordListResponseSchema,
  recordSchema,
  sceneListResponseSchema,
  sceneSchema,
  stageRecordsResponseSchema,
  statBlockListResponseSchema,
  statBlockSchema,
  visualsResponseSchema,
  type AssetSummary,
  type BacklinksResponse,
  type GenerateVisualRequest,
  type ReviseVisualRequest,
  type VisualsResponse,
  type Campaign,
  type CampaignRecord,
  type Character,
  type AnswerQuestionsRequest,
  type CommitImportResponse,
  type GenerateRecordsRequest,
  type ImportDetail,
  type ImportEstimateResponse,
  type ImportSummary,
  type PatchProposalRequest,
  type PatchProposalResponse,
  type StartImportRequest,
  type UsageResponse,
  type CharacterSheet,
  type CharacterSheetPatch,
  type CreateCharacterRequest,
  type CreateEntryRequest,
  type JournalRecord,
  type JournalRecordListQuery,
  type JournalRecordSummary,
  type PlayerEntry,
  type PlayerNote,
  type UpdateEntryRequest,
  type CreateRecordRequest,
  type CreateStatBlockRequest,
  type Invite,
  type InviteExpiry,
  type InvitePreview,
  type MeResponse,
  type Member,
  type PlayerCharacterSheet,
  type PlaySession,
  type SessionLogEntry,
  type Provider,
  type ProviderCredential,
  type RecordListItem,
  type RecordType,
  type CreateSceneRequest,
  type Scene,
  type SceneObjectInput,
  type SceneSummary,
  type StageRecordsResponse,
  type UpdateSceneRequest,
  type StatBlock,
  type StatBlockSummary,
  type UpdateMeRequest,
  type UpdateRecordRequest,
  type UpdateStatBlockRequest,
  domainCardListResponseSchema,
  domainCardSchema,
  domainListResponseSchema,
  domainSchema,
  type CreateDomainCardRequest,
  type CreateDomainRequest,
  type Domain,
  type DomainCard,
  type DomainCardSummary,
  type DomainSummary,
  type UpdateDomainCardRequest,
  type UpdateDomainRequest,
} from '@stagehand/shared';

export class ApiError extends Error {
  override name = 'ApiError';

  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (!headers.has('accept')) headers.set('accept', 'application/json');
  if (init.body !== undefined && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }
  return fetch(path, { credentials: 'same-origin', ...init, headers });
}

async function errorFrom(response: Response): Promise<ApiError> {
  let message = `Request failed (${String(response.status)})`;
  try {
    const body = (await response.json()) as { message?: unknown; issues?: { message?: unknown }[] };
    const detail = body.issues?.[0]?.message ?? body.message;
    if (typeof detail === 'string') message = detail;
  } catch {
    // Not JSON: keep the generic message.
  }
  return new ApiError(response.status, message);
}

/** The signed-in user's profile, or null when signed out. */
export async function fetchMe(): Promise<MeResponse | null> {
  const response = await request('/api/me');
  if (response.status === 401) return null;
  if (!response.ok) throw await errorFrom(response);
  return meResponseSchema.parse(await response.json());
}

export async function updateMe(update: UpdateMeRequest): Promise<MeResponse> {
  const response = await request('/api/me', { method: 'PATCH', body: JSON.stringify(update) });
  if (!response.ok) throw await errorFrom(response);
  return meResponseSchema.parse(await response.json());
}

/** The user's stored AI provider keys: provider, last four characters and date only. */
export async function fetchProviderCredentials(): Promise<ProviderCredential[]> {
  const response = await request('/api/me/credentials');
  if (!response.ok) throw await errorFrom(response);
  return providerCredentialsResponseSchema.parse(await response.json()).credentials;
}

/**
 * Sends a new key for a provider (the only time a key leaves the browser). The server checks
 * it with the provider first and refuses keys the provider doesn't accept.
 */
export async function saveProviderKey(
  provider: Provider,
  apiKey: string,
): Promise<ProviderCredential> {
  const response = await request(`/api/me/credentials/${provider}`, {
    method: 'PUT',
    body: JSON.stringify({ apiKey }),
  });
  if (!response.ok) throw await errorFrom(response);
  return providerCredentialSchema.parse(await response.json());
}

export async function deleteProviderKey(provider: Provider): Promise<void> {
  const response = await request(`/api/me/credentials/${provider}`, { method: 'DELETE' });
  if (!response.ok) throw await errorFrom(response);
}

/** Every campaign the user belongs to, active and archived. */
export async function fetchCampaigns(): Promise<Campaign[]> {
  const response = await request('/api/campaigns');
  if (!response.ok) throw await errorFrom(response);
  return campaignListResponseSchema.parse(await response.json()).campaigns;
}

/** One campaign, or null when it doesn't exist or the user isn't a member. */
export async function fetchCampaign(id: string): Promise<Campaign | null> {
  const response = await request(`/api/campaigns/${encodeURIComponent(id)}`);
  if (response.status === 404) return null;
  if (!response.ok) throw await errorFrom(response);
  return campaignSchema.parse(await response.json());
}

/**
 * Creates a campaign; the signed-in user becomes its GM. With `copyGameplayFrom` (a campaign
 * they run), it starts with a copy of that campaign's gameplay records (F4.3).
 */
export async function createCampaign(input: {
  name: string;
  copyGameplayFrom?: string;
}): Promise<Campaign> {
  return campaignWrite('/api/campaigns', 'POST', input);
}

export async function renameCampaign(id: string, name: string): Promise<Campaign> {
  return campaignWrite(`/api/campaigns/${encodeURIComponent(id)}`, 'PATCH', { name });
}

/** Archives (read-only) or unarchives a campaign. */
export async function setCampaignArchived(id: string, archived: boolean): Promise<Campaign> {
  const action = archived ? 'archive' : 'unarchive';
  return campaignWrite(`/api/campaigns/${encodeURIComponent(id)}/${action}`, 'POST');
}

async function campaignWrite(path: string, method: 'POST' | 'PATCH', body?: unknown) {
  const response = await request(path, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) throw await errorFrom(response);
  return campaignSchema.parse(await response.json());
}

const campaignPath = (campaignId: string, rest = '') =>
  `/api/campaigns/${encodeURIComponent(campaignId)}${rest}`;

/** Sends a write and throws on failure; returns the response for callers that read a body. */
async function send(
  path: string,
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  body?: unknown,
  init: Pick<RequestInit, 'keepalive'> = {},
) {
  const response = await request(path, {
    method,
    ...init,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) throw await errorFrom(response);
  return response;
}

async function getJson(path: string): Promise<unknown> {
  const response = await request(path);
  if (!response.ok) throw await errorFrom(response);
  return response.json();
}

/** Everyone in the campaign: the GM first, then players. */
export async function fetchMembers(campaignId: string): Promise<Member[]> {
  return memberListResponseSchema.parse(await getJson(campaignPath(campaignId, '/members')))
    .members;
}

/** The GM removes a player, or a player leaves (their own user id). */
export async function removeMember(campaignId: string, userId: string): Promise<void> {
  await send(campaignPath(campaignId, `/members/${encodeURIComponent(userId)}`), 'DELETE');
}

/** Gives a player a PC (moving it from anyone who had it), or none with null. GM only. */
export async function assignCharacter(
  campaignId: string,
  userId: string,
  characterId: string | null,
): Promise<void> {
  await send(campaignPath(campaignId, `/members/${encodeURIComponent(userId)}/character`), 'PUT', {
    characterId,
  });
}

/** Every PC in the campaign. GM only. */
export async function fetchCharacters(campaignId: string): Promise<Character[]> {
  return characterListResponseSchema.parse(await getJson(campaignPath(campaignId, '/characters')))
    .characters;
}

/** Creates a PC, optionally assigned to a player straight away. GM only. */
export async function createCharacter(
  campaignId: string,
  input: CreateCharacterRequest,
): Promise<Character> {
  const response = await send(campaignPath(campaignId, '/characters'), 'POST', input);
  return characterSchema.parse(await response.json());
}

/** The campaign's active invite links. GM only. */
export async function fetchInvites(campaignId: string): Promise<Invite[]> {
  return inviteListResponseSchema.parse(await getJson(campaignPath(campaignId, '/invites')))
    .invites;
}

export async function createInvite(campaignId: string, expiresIn: InviteExpiry): Promise<Invite> {
  const response = await send(campaignPath(campaignId, '/invites'), 'POST', { expiresIn });
  return inviteSchema.parse(await response.json());
}

export async function revokeInvite(campaignId: string, inviteId: string): Promise<void> {
  await send(campaignPath(campaignId, `/invites/${encodeURIComponent(inviteId)}/revoke`), 'POST');
}

/** What an invite link leads to, or null if it has expired, been revoked or never existed. */
export async function fetchInvitePreview(code: string): Promise<InvitePreview | null> {
  const response = await request(`/api/invites/${encodeURIComponent(code)}`);
  if (response.status === 404) return null;
  if (!response.ok) throw await errorFrom(response);
  return invitePreviewSchema.parse(await response.json());
}

/** Joins the invite's campaign as a player; returns the campaign id. */
export async function acceptInvite(code: string): Promise<string> {
  const response = await send(`/api/invites/${encodeURIComponent(code)}/accept`, 'POST');
  return acceptInviteResponseSchema.parse(await response.json()).campaignId;
}

const recordsPath = (campaignId: string, recordId?: string) =>
  campaignPath(
    campaignId,
    recordId === undefined ? '/records' : `/records/${encodeURIComponent(recordId)}`,
  );

/** What the records list can be narrowed by (D-25); every filter given must match. */
export interface RecordListFilter {
  type?: RecordType;
  /** Search text; blank means no search. */
  q?: string;
  /** The record must have every one of these tags. */
  tags?: readonly string[];
  /** Only the Spots of this Area. */
  areaId?: string;
  limit?: number;
}

/**
 * The campaign's records, narrowed by `filter`: by name, or by how well they match `q`,
 * each with an excerpt when only its text matched. GM only.
 */
export async function fetchRecords(
  campaignId: string,
  filter: RecordListFilter = {},
): Promise<RecordListItem[]> {
  const params = new URLSearchParams();
  if (filter.type !== undefined) params.set('type', filter.type);
  if (filter.q !== undefined && filter.q.trim() !== '') params.set('q', filter.q.trim());
  for (const tag of filter.tags ?? []) params.append('tag', tag);
  if (filter.areaId !== undefined) params.set('areaId', filter.areaId);
  if (filter.limit !== undefined) params.set('limit', String(filter.limit));
  const query = params.toString();
  return recordListResponseSchema.parse(
    await getJson(`${recordsPath(campaignId)}${query === '' ? '' : `?${query}`}`),
  ).records;
}

/** One record with every field, or null when it isn't in this campaign. GM only. */
export async function fetchRecord(
  campaignId: string,
  recordId: string,
): Promise<CampaignRecord | null> {
  const response = await request(recordsPath(campaignId, recordId));
  if (response.status === 404) return null;
  if (!response.ok) throw await errorFrom(response);
  return recordSchema.parse(await response.json());
}

/** Creates a record. GM only; refused while archived. */
export async function createRecord(
  campaignId: string,
  input: CreateRecordRequest,
): Promise<CampaignRecord> {
  const response = await send(recordsPath(campaignId), 'POST', input);
  return recordSchema.parse(await response.json());
}

/**
 * Applies a partial update (D-22): any subset of the keys, with `fields` merged on the
 * server. `keepalive` lets a last save go out while the page unloads.
 */
export async function patchRecord(
  campaignId: string,
  recordId: string,
  patch: UpdateRecordRequest,
  init: { keepalive?: boolean } = {},
): Promise<CampaignRecord> {
  const response = await send(recordsPath(campaignId, recordId), 'PATCH', patch, init);
  return recordSchema.parse(await response.json());
}

/**
 * Reveals a record to players, or takes it back (F3.4, governance §7). Answers the record. GM
 * only; refused while the campaign is archived.
 */
export async function setRecordRevealed(
  campaignId: string,
  recordId: string,
  revealed: boolean,
): Promise<CampaignRecord> {
  const response = await send(
    `${recordsPath(campaignId, recordId)}/${revealed ? 'reveal' : 'unreveal'}`,
    'POST',
  );
  return recordSchema.parse(await response.json());
}

/** Deletes a record for good. An Area that still has Spots is refused (409). GM only. */
export async function deleteRecord(campaignId: string, recordId: string): Promise<void> {
  await send(recordsPath(campaignId, recordId), 'DELETE');
}

/** Everything pointing at a record (D-24), or null when it isn't in this campaign. GM only. */
export async function fetchBacklinks(
  campaignId: string,
  recordId: string,
): Promise<BacklinksResponse | null> {
  const response = await request(`${recordsPath(campaignId, recordId)}/backlinks`);
  if (response.status === 404) return null;
  if (!response.ok) throw await errorFrom(response);
  return backlinksResponseSchema.parse(await response.json());
}

const characterPath = (campaignId: string, characterId: string) =>
  campaignPath(campaignId, `/characters/${encodeURIComponent(characterId)}`);

/** Fetches a path, returning null on 404 and the parsed body otherwise. */
async function getOrNull<T>(path: string, parse: (body: unknown) => T): Promise<T | null> {
  const response = await request(path);
  if (response.status === 404) return null;
  if (!response.ok) throw await errorFrom(response);
  return parse(await response.json());
}

/** A PC's full sheet, or null when it isn't in this campaign. GM only. */
export async function fetchCharacterSheet(
  campaignId: string,
  characterId: string,
): Promise<CharacterSheet | null> {
  return getOrNull(characterPath(campaignId, characterId), (body) =>
    characterSheetSchema.parse(body),
  );
}

/** The signed-in player's own PC, without the GM's private parts; null for any other PC. */
export async function fetchOwnCharacterSheet(
  campaignId: string,
  characterId: string,
): Promise<PlayerCharacterSheet | null> {
  return getOrNull(characterPath(campaignId, characterId), (body) =>
    playerCharacterSheetSchema.parse(body),
  );
}

/** Applies a partial update (D-23): each key replaces its whole value. GM only. */
export async function patchCharacterSheet(
  campaignId: string,
  characterId: string,
  patch: CharacterSheetPatch,
  init: { keepalive?: boolean } = {},
): Promise<CharacterSheet> {
  const response = await send(characterPath(campaignId, characterId), 'PATCH', patch, init);
  return characterSheetSchema.parse(await response.json());
}

/** Deletes a PC for good; its player stays without one. GM only. */
export async function deleteCharacter(campaignId: string, characterId: string): Promise<void> {
  await send(characterPath(campaignId, characterId), 'DELETE');
}

const statBlocksPath = (campaignId: string, statBlockId?: string) =>
  campaignPath(
    campaignId,
    statBlockId === undefined ? '/stat-blocks' : `/stat-blocks/${encodeURIComponent(statBlockId)}`,
  );

/** The campaign's stat blocks, by name. GM only. */
export async function fetchStatBlocks(campaignId: string): Promise<StatBlockSummary[]> {
  return statBlockListResponseSchema.parse(await getJson(statBlocksPath(campaignId))).statBlocks;
}

/** One stat block, or null when it isn't in this campaign. GM only. */
export async function fetchStatBlock(
  campaignId: string,
  statBlockId: string,
): Promise<StatBlock | null> {
  return getOrNull(statBlocksPath(campaignId, statBlockId), (body) => statBlockSchema.parse(body));
}

export async function createStatBlock(
  campaignId: string,
  input: CreateStatBlockRequest,
): Promise<StatBlock> {
  const response = await send(statBlocksPath(campaignId), 'POST', input);
  return statBlockSchema.parse(await response.json());
}

/** Applies a partial update: each key replaces its whole value. GM only. */
export async function patchStatBlock(
  campaignId: string,
  statBlockId: string,
  patch: UpdateStatBlockRequest,
  init: { keepalive?: boolean } = {},
): Promise<StatBlock> {
  const response = await send(statBlocksPath(campaignId, statBlockId), 'PATCH', patch, init);
  return statBlockSchema.parse(await response.json());
}

/** Deletes a stat block for good; NPCs that used it are unlinked. GM only. */
export async function deleteStatBlock(campaignId: string, statBlockId: string): Promise<void> {
  await send(statBlocksPath(campaignId, statBlockId), 'DELETE');
}

const domainsPath = (campaignId: string, domainId?: string) =>
  campaignPath(
    campaignId,
    domainId === undefined ? '/domains' : `/domains/${encodeURIComponent(domainId)}`,
  );
const cardsPath = (campaignId: string, cardId?: string) =>
  campaignPath(
    campaignId,
    cardId === undefined ? '/domain-cards' : `/domain-cards/${encodeURIComponent(cardId)}`,
  );

/** The campaign's domains, by name (F4.3). Any member. */
export async function fetchDomains(campaignId: string): Promise<DomainSummary[]> {
  return domainListResponseSchema.parse(await getJson(domainsPath(campaignId))).domains;
}

/** A domain with its cards, or null when it isn't in this campaign. */
export async function fetchDomain(campaignId: string, domainId: string): Promise<Domain | null> {
  return getOrNull(domainsPath(campaignId, domainId), (body) => domainSchema.parse(body));
}

export async function createDomain(
  campaignId: string,
  input: CreateDomainRequest,
): Promise<Domain> {
  const response = await send(domainsPath(campaignId), 'POST', input);
  return domainSchema.parse(await response.json());
}

export async function patchDomain(
  campaignId: string,
  domainId: string,
  patch: UpdateDomainRequest,
  init: { keepalive?: boolean } = {},
): Promise<Domain> {
  const response = await send(domainsPath(campaignId, domainId), 'PATCH', patch, init);
  return domainSchema.parse(await response.json());
}

/** Deletes a domain no card uses; otherwise refused with the cards named. GM only. */
export async function deleteDomain(campaignId: string, domainId: string): Promise<void> {
  await send(domainsPath(campaignId, domainId), 'DELETE');
}

/** Every domain card of the campaign, by domain, level and name. Any member. */
export async function fetchDomainCards(campaignId: string): Promise<DomainCardSummary[]> {
  return domainCardListResponseSchema.parse(await getJson(cardsPath(campaignId))).cards;
}

/** A domain card, or null when it isn't in this campaign. */
export async function fetchDomainCard(
  campaignId: string,
  cardId: string,
): Promise<DomainCard | null> {
  return getOrNull(cardsPath(campaignId, cardId), (body) => domainCardSchema.parse(body));
}

export async function createDomainCard(
  campaignId: string,
  input: CreateDomainCardRequest,
): Promise<DomainCard> {
  const response = await send(cardsPath(campaignId), 'POST', input);
  return domainCardSchema.parse(await response.json());
}

export async function patchDomainCard(
  campaignId: string,
  cardId: string,
  patch: UpdateDomainCardRequest,
  init: { keepalive?: boolean } = {},
): Promise<DomainCard> {
  const response = await send(cardsPath(campaignId, cardId), 'PATCH', patch, init);
  return domainCardSchema.parse(await response.json());
}

export async function deleteDomainCard(campaignId: string, cardId: string): Promise<void> {
  await send(cardsPath(campaignId, cardId), 'DELETE');
}

const importsPath = (campaignId: string, rest = '') => campaignPath(campaignId, `/imports${rest}`);
const importPath = (campaignId: string, importId: string, rest = '') =>
  importsPath(campaignId, `/${encodeURIComponent(importId)}${rest}`);

/** What sending this import would cost, from a free token count (D-27). GM only. */
export async function estimateImport(
  campaignId: string,
  input: StartImportRequest,
): Promise<ImportEstimateResponse> {
  const response = await send(importsPath(campaignId, '/estimate'), 'POST', input);
  return importEstimateResponseSchema.parse(await response.json());
}

/** Starts an import; it runs in the background and answers `running` at once. GM only. */
export async function startImport(
  campaignId: string,
  input: StartImportRequest,
): Promise<ImportSummary> {
  const response = await send(importsPath(campaignId), 'POST', input);
  return importSummarySchema.parse(await response.json());
}

/** The campaign's imports, newest first. GM only. */
export async function fetchImports(campaignId: string): Promise<ImportSummary[]> {
  return importListResponseSchema.parse(await getJson(importsPath(campaignId))).imports;
}

/** One import with its proposals, or null when it isn't in this campaign. GM only. */
export async function fetchImport(
  campaignId: string,
  importId: string,
): Promise<ImportDetail | null> {
  return getOrNull(importPath(campaignId, importId), (body) => importDetailSchema.parse(body));
}

/** Accepts, rejects or edits one proposal (send the whole payload on an edit). */
export async function patchProposal(
  campaignId: string,
  importId: string,
  proposalId: string,
  patch: PatchProposalRequest,
): Promise<PatchProposalResponse> {
  const response = await send(
    importPath(campaignId, importId, `/proposals/${encodeURIComponent(proposalId)}`),
    'PATCH',
    patch,
  );
  return patchProposalResponseSchema.parse(await response.json());
}

/** Accepts every pending proposal; rejected ones stay rejected. */
export async function acceptAllProposals(
  campaignId: string,
  importId: string,
): Promise<ImportDetail> {
  const response = await send(importPath(campaignId, importId, '/accept-all'), 'POST');
  return importDetailSchema.parse(await response.json());
}

/** Saves every accepted proposal in one transaction; pending ones are left out. */
export async function commitImport(
  campaignId: string,
  importId: string,
): Promise<CommitImportResponse> {
  const response = await send(importPath(campaignId, importId, '/commit'), 'POST');
  return commitImportResponseSchema.parse(await response.json());
}

/** Sends the GM's answers to the waiting questions; the model may ask more (D-30). */
export async function answerImportQuestions(
  campaignId: string,
  importId: string,
  input: AnswerQuestionsRequest,
): Promise<ImportSummary> {
  const response = await send(importPath(campaignId, importId, '/answers'), 'POST', input);
  return importSummarySchema.parse(await response.json());
}

/** Stops the questions and has the model write the records, with a last answer if given. */
export async function generateImportRecords(
  campaignId: string,
  importId: string,
  input: GenerateRecordsRequest,
): Promise<ImportSummary> {
  const response = await send(importPath(campaignId, importId, '/generate'), 'POST', input);
  return importSummarySchema.parse(await response.json());
}

/** Runs a failed step of an import again, with the same notes and answers. */
export async function retryImport(campaignId: string, importId: string): Promise<ImportSummary> {
  const response = await send(importPath(campaignId, importId, '/retry'), 'POST');
  return importSummarySchema.parse(await response.json());
}

/** Drops an import without saving anything (not while it's running or once it's saved). */
export async function discardImport(campaignId: string, importId: string): Promise<ImportSummary> {
  const response = await send(importPath(campaignId, importId, '/discard'), 'POST');
  return importSummarySchema.parse(await response.json());
}

/** The signed-in GM's imports and token usage across their campaigns. */
export async function fetchUsage(): Promise<UsageResponse> {
  return usageResponseSchema.parse(await getJson('/api/me/usage'));
}

/** Whose visual (F2.3): a record's or a PC's. */
export type VisualOwnerRef = { recordId: string } | { characterId: string };

const visualOwnerPath = (campaignId: string, owner: VisualOwnerRef) =>
  'recordId' in owner
    ? recordsPath(campaignId, owner.recordId)
    : characterPath(campaignId, owner.characterId);

/** A record's or PC's image in use and its drafts under review (F2.5). GM only. */
export async function fetchVisuals(
  campaignId: string,
  owner: VisualOwnerRef,
): Promise<VisualsResponse> {
  return visualsResponseSchema.parse(
    await getJson(`${visualOwnerPath(campaignId, owner)}/visuals`),
  );
}

/** Starts making an image; it runs in the background and answers `generating` at once. */
export async function generateVisual(
  campaignId: string,
  owner: VisualOwnerRef,
  input: GenerateVisualRequest,
): Promise<AssetSummary> {
  const response = await send(`${visualOwnerPath(campaignId, owner)}/visuals`, 'POST', input);
  return assetSummarySchema.parse(await response.json());
}

/**
 * Regenerate with notes (F2.5): the image's untouched original goes back to the model with the
 * notes; the change is made in the background and answers `generating` at once.
 */
export async function reviseVisual(
  campaignId: string,
  owner: VisualOwnerRef,
  assetId: string,
  notes: string,
): Promise<AssetSummary> {
  const response = await send(
    `${visualOwnerPath(campaignId, owner)}/visuals/${encodeURIComponent(assetId)}/revise`,
    'POST',
    { notes } satisfies ReviseVisualRequest,
  );
  return assetSummarySchema.parse(await response.json());
}

/** "Use this" / "Replace": makes a draft the record's or PC's visual. */
export async function chooseVisual(
  campaignId: string,
  owner: VisualOwnerRef,
  assetId: string,
): Promise<VisualsResponse> {
  const response = await send(`${visualOwnerPath(campaignId, owner)}/visual`, 'PUT', {
    assetId,
  });
  return visualsResponseSchema.parse(await response.json());
}

/** "Discard", "Keep current", "Keep new", "Go back", or dismissing a failed try (F2.5). */
export async function discardVisual(
  campaignId: string,
  owner: VisualOwnerRef,
  assetId: string,
): Promise<VisualsResponse> {
  const response = await send(
    `${visualOwnerPath(campaignId, owner)}/visuals/${encodeURIComponent(assetId)}`,
    'DELETE',
  );
  return visualsResponseSchema.parse(await response.json());
}

const scenesPath = (campaignId: string, sceneId?: string) =>
  campaignPath(
    campaignId,
    sceneId === undefined ? '/scenes' : `/scenes/${encodeURIComponent(sceneId)}`,
  );

/** The campaign's scenes, by name (F3.2). GM only. */
export async function fetchScenes(campaignId: string): Promise<SceneSummary[]> {
  return sceneListResponseSchema.parse(await getJson(scenesPath(campaignId))).scenes;
}

/** One scene with its Spot, objects and suggestions, or null when it isn't in this campaign. */
export async function fetchScene(campaignId: string, sceneId: string): Promise<Scene | null> {
  return getOrNull(scenesPath(campaignId, sceneId), (body) => sceneSchema.parse(body));
}

/** Creates an empty scene, with a Spot's backdrop when one is given. */
export async function createScene(campaignId: string, input: CreateSceneRequest): Promise<Scene> {
  const response = await send(scenesPath(campaignId), 'POST', input);
  return sceneSchema.parse(await response.json());
}

/** Renames a scene, or changes or clears its Spot. */
export async function patchScene(
  campaignId: string,
  sceneId: string,
  patch: UpdateSceneRequest,
): Promise<Scene> {
  const response = await send(scenesPath(campaignId, sceneId), 'PATCH', patch);
  return sceneSchema.parse(await response.json());
}

/** Deletes a scene and everything placed in it; the records stay. */
export async function deleteScene(campaignId: string, sceneId: string): Promise<void> {
  await send(scenesPath(campaignId, sceneId), 'DELETE');
}

/**
 * Saves a scene's whole list of props and puppets, in order (D-49): objects left out are
 * removed. `keepalive` lets a last save go out while the page unloads.
 */
export async function saveSceneObjects(
  campaignId: string,
  sceneId: string,
  objects: readonly SceneObjectInput[],
  init: { keepalive?: boolean } = {},
): Promise<Scene> {
  const response = await send(
    `${scenesPath(campaignId, sceneId)}/objects`,
    'PUT',
    { objects },
    init,
  );
  return sceneSchema.parse(await response.json());
}

const playSessionPath = (campaignId: string, rest = '') =>
  campaignPath(campaignId, `/play-session${rest}`);

/** The campaign's running session (F3.3), or null. Any member. */
export async function fetchPlaySession(campaignId: string): Promise<PlaySession | null> {
  return playSessionResponseSchema.parse(await getJson(playSessionPath(campaignId))).session;
}

/** Starts a session, or answers the one already running. GM only; refused while archived. */
export async function startPlaySession(campaignId: string): Promise<PlaySession | null> {
  const response = await send(playSessionPath(campaignId), 'POST');
  return playSessionResponseSchema.parse(await response.json()).session;
}

/** Ends the running session for everyone. GM only. */
export async function endPlaySession(campaignId: string): Promise<void> {
  await send(playSessionPath(campaignId, '/end'), 'POST');
}

/** The running session's log in words, newest first (F3.6). GM only; empty with none running. */
export async function fetchSessionLog(campaignId: string): Promise<SessionLogEntry[]> {
  return sessionLogResponseSchema.parse(await getJson(playSessionPath(campaignId, '/log'))).entries;
}

/** What the scene builder's tray offers: placeable records with an image, and every Spot. */
export async function fetchStageRecords(campaignId: string): Promise<StageRecordsResponse> {
  return stageRecordsResponseSchema.parse(
    await getJson(campaignPath(campaignId, '/stage-records')),
  );
}

// --- The player journal (F3.5) ------------------------------------------------------------

const journalPath = (campaignId: string, rest = '') => campaignPath(campaignId, `/journal${rest}`);

/** Where a record's or an entry's notes live. */
export type NoteSubjectRef = { recordId: string } | { entryId: string };

const notesPath = (campaignId: string, subject: NoteSubjectRef) =>
  'recordId' in subject
    ? journalPath(campaignId, `/records/${subject.recordId}/notes`)
    : journalPath(campaignId, `/entries/${subject.entryId}/notes`);

/** Revealed records, by name or by how well they match `q`. Any member. */
export async function fetchJournalRecords(
  campaignId: string,
  filter: JournalRecordListQuery = {},
): Promise<JournalRecordSummary[]> {
  const params = new URLSearchParams();
  if (filter.type !== undefined) params.set('type', filter.type);
  if (filter.q !== undefined && filter.q.trim() !== '') params.set('q', filter.q.trim());
  const query = params.toString();
  return journalRecordListResponseSchema.parse(
    await getJson(journalPath(campaignId, `/records${query === '' ? '' : `?${query}`}`)),
  ).records;
}

/** A revealed record's public layer, or null when players don't have it. */
export async function fetchJournalRecord(
  campaignId: string,
  recordId: string,
): Promise<JournalRecord | null> {
  const response = await request(journalPath(campaignId, `/records/${recordId}`));
  if (response.status === 404) return null;
  if (!response.ok) throw await errorFrom(response);
  return journalRecordSchema.parse(await response.json());
}

export async function fetchEntries(campaignId: string): Promise<PlayerEntry[]> {
  return playerEntryListResponseSchema.parse(await getJson(journalPath(campaignId, '/entries')))
    .entries;
}

/** One player entry, or null when it was deleted. */
export async function fetchEntry(campaignId: string, entryId: string): Promise<PlayerEntry | null> {
  const response = await request(journalPath(campaignId, `/entries/${entryId}`));
  if (response.status === 404) return null;
  if (!response.ok) throw await errorFrom(response);
  return playerEntrySchema.parse(await response.json());
}

/** A new entry. Players only; refused while archived. */
export async function createEntry(
  campaignId: string,
  input: CreateEntryRequest,
): Promise<PlayerEntry> {
  const response = await send(journalPath(campaignId, '/entries'), 'POST', input);
  return playerEntrySchema.parse(await response.json());
}

/** Its author changes an entry. */
export async function updateEntry(
  campaignId: string,
  entryId: string,
  patch: UpdateEntryRequest,
): Promise<PlayerEntry> {
  const response = await send(journalPath(campaignId, `/entries/${entryId}`), 'PATCH', patch);
  return playerEntrySchema.parse(await response.json());
}

/** Its author, or the GM, deletes an entry and its notes. */
export async function deleteEntry(campaignId: string, entryId: string): Promise<void> {
  await send(journalPath(campaignId, `/entries/${entryId}`), 'DELETE');
}

/** A record's or entry's notes, newest first; null when it is gone or no longer revealed. */
export async function fetchNotes(
  campaignId: string,
  subject: NoteSubjectRef,
): Promise<PlayerNote[] | null> {
  const response = await request(notesPath(campaignId, subject));
  if (response.status === 404) return null;
  if (!response.ok) throw await errorFrom(response);
  return playerNoteListResponseSchema.parse(await response.json()).notes;
}

export async function createNote(
  campaignId: string,
  subject: NoteSubjectRef,
  body: string,
): Promise<PlayerNote> {
  const response = await send(notesPath(campaignId, subject), 'POST', { body });
  return playerNoteSchema.parse(await response.json());
}

/** Its author changes a note. */
export async function updateNote(
  campaignId: string,
  noteId: string,
  body: string,
): Promise<PlayerNote> {
  const response = await send(campaignPath(campaignId, `/notes/${noteId}`), 'PATCH', { body });
  return playerNoteSchema.parse(await response.json());
}

/** Its author, or the GM, deletes a note. */
export async function deleteNote(campaignId: string, noteId: string): Promise<void> {
  await send(campaignPath(campaignId, `/notes/${noteId}`), 'DELETE');
}
