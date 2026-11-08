import { meResponseSchema, type MeResponse, type UpdateMeRequest } from '@stagehand/shared';

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
