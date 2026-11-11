import {
  acceptInviteResponseSchema,
  backlinksResponseSchema,
  campaignListResponseSchema,
  campaignSchema,
  characterListResponseSchema,
  characterSchema,
  characterSheetSchema,
  inviteListResponseSchema,
  invitePreviewSchema,
  inviteSchema,
  memberListResponseSchema,
  meResponseSchema,
  playerCharacterSheetSchema,
  recordListResponseSchema,
  recordSchema,
  statBlockListResponseSchema,
  statBlockSchema,
  type BacklinksResponse,
  type Campaign,
  type CampaignRecord,
  type Character,
  type CharacterSheet,
  type CharacterSheetPatch,
  type CreateCharacterRequest,
  type CreateRecordRequest,
  type CreateStatBlockRequest,
  type Invite,
  type InviteExpiry,
  type InvitePreview,
  type MeResponse,
  type Member,
  type PlayerCharacterSheet,
  type RecordListItem,
  type RecordType,
  type StatBlock,
  type StatBlockSummary,
  type UpdateMeRequest,
  type UpdateRecordRequest,
  type UpdateStatBlockRequest,
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

/** Creates a campaign; the signed-in user becomes its GM. */
export async function createCampaign(name: string): Promise<Campaign> {
  return campaignWrite('/api/campaigns', 'POST', { name });
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
