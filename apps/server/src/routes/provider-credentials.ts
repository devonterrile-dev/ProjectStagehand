/**
 * A user's own AI provider keys (F1.7, governance §14, D-26). User-scoped: no campaign in
 * the path, and every query is filtered by the signed-in user.
 *
 * GET    /api/me/credentials            → { credentials: [{ provider, lastFour, createdAt }] }
 * PUT    /api/me/credentials/anthropic  { apiKey } → checked with Anthropic, then stored
 * DELETE /api/me/credentials/anthropic  → 204 (also when there was none)
 *
 * A key travels browser → server once and never comes back. Responses are built from the
 * shared summary schema, which has no key field. OpenRouter (F2.2) has no route yet, so its
 * paths are 404.
 */
import {
  saveAnthropicKeyRequestSchema,
  providerCredentialsResponseSchema,
} from '@stagehand/shared';
import type { FastifyInstance, FastifyReply } from 'fastify';

import { type Auth } from '../auth/auth';
import { requireSession, sessionOf } from '../auth/routes';
import { deleteProviderKey, listProviderCredentials, saveProviderKey } from '../credentials/store';
import type { Database } from '../db/client';
import { sendValidationError } from '../http/errors';
import type { AnthropicProvider, KeyCheckResult } from '../providers/anthropic';

export interface CredentialDeps {
  /** CREDENTIALS_ENCRYPTION_KEY, decoded. */
  key: Buffer;
  anthropic: AnthropicProvider;
}

const NOTHING_SAVED = 'Nothing was saved.';

/** Why a key wasn't stored, for each failed check. */
const REFUSALS: Record<Exclude<KeyCheckResult, 'ok'>, { status: number; message: string }> = {
  rejected: {
    status: 400,
    message: `Anthropic didn't accept this key. Check that you copied all of it, and that it hasn't been deleted. ${NOTHING_SAVED}`,
  },
  forbidden: {
    status: 400,
    message: `Anthropic accepted this key but won't let it use the API. Check the key's workspace and permissions in the Anthropic Console. ${NOTHING_SAVED}`,
  },
  rate_limited: {
    status: 503,
    message: `Anthropic is rate limiting this key right now. Try again in a minute. ${NOTHING_SAVED}`,
  },
  unreachable: {
    status: 502,
    message: `Couldn't reach Anthropic to check the key. Try again in a moment. ${NOTHING_SAVED}`,
  },
};

const STATUS_NAMES: Record<number, string> = {
  400: 'Bad Request',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
};

function refuse(reply: FastifyReply, status: number, message: string): FastifyReply {
  // Answered here rather than thrown, so a refusal never reaches the error logger.
  return reply.code(status).send({ statusCode: status, error: STATUS_NAMES[status], message });
}

export function registerProviderCredentialRoutes(
  app: FastifyInstance,
  deps: { auth: Auth; db: Database; credentials: CredentialDeps },
): void {
  const preHandler = requireSession(deps.auth);
  const { db, credentials } = deps;

  app.get('/api/me/credentials', { preHandler }, async (request) => {
    const { user } = sessionOf(request);
    return providerCredentialsResponseSchema.parse({
      credentials: await listProviderCredentials(db, user.id),
    });
  });

  app.put('/api/me/credentials/anthropic', { preHandler }, async (request, reply) => {
    const { user } = sessionOf(request);

    const parsed = saveAnthropicKeyRequestSchema.safeParse(request.body);
    if (!parsed.success) return sendValidationError(reply, parsed.error);
    const { apiKey } = parsed.data;

    const result = await credentials.anthropic.checkKey(apiKey);
    if (result !== 'ok') {
      const refusal = REFUSALS[result];
      return refuse(reply, refusal.status, refusal.message);
    }

    return saveProviderKey(db, credentials.key, user.id, 'anthropic', apiKey);
  });

  app.delete('/api/me/credentials/anthropic', { preHandler }, async (request, reply) => {
    const { user } = sessionOf(request);
    await deleteProviderKey(db, user.id, 'anthropic');
    return reply.code(204).send();
  });
}
