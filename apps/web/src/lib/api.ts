import {
  acceptInviteResponseSchema,
  campaignListResponseSchema,
  campaignSchema,
  characterListResponseSchema,
  characterSchema,
  inviteListResponseSchema,
  invitePreviewSchema,
  inviteSchema,
  memberListResponseSchema,
  meResponseSchema,
  type Campaign,
  type Character,
  type CreateCharacterRequest,
  type Invite,
  type InviteExpiry,
  type InvitePreview,
  type MeResponse,
  type Member,
  type UpdateMeRequest,
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
async function send(path: string, method: 'POST' | 'PUT' | 'DELETE', body?: unknown) {
  const response = await request(path, {
    method,
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
