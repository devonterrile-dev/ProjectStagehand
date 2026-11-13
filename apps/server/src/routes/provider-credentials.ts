/**
 * A user's own AI provider keys (F1.7 Anthropic, F2.2 OpenRouter; governance §14, D-26,
 * D-40). User-scoped: no campaign in the path, and every query is filtered by the signed-in
 * user.
 *
 * GET    /api/me/credentials             → { credentials: [{ provider, lastFour, createdAt }] }
 * PUT    /api/me/credentials/:provider   { apiKey } → checked with the provider, then stored
 * DELETE /api/me/credentials/:provider   → 204 (also when there was none)
 *
 * `:provider` is `anthropic` or `openrouter`; anything else is 404. A key travels browser →
 * server once and never comes back. Responses are built from the shared summary schema,
 * which has no key field.
 */
import {
  providerCredentialsResponseSchema,
  providerSchema,
  saveProviderKeyRequestSchemas,
  type Provider,
} from '@stagehand/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { type Auth } from '../auth/auth';
import { requireSession, sessionOf } from '../auth/routes';
import { deleteProviderKey, listProviderCredentials, saveProviderKey } from '../credentials/store';
import type { Database } from '../db/client';
import { sendValidationError } from '../http/errors';
import type { AnthropicProvider } from '../providers/anthropic';
import type { KeyCheckResult } from '../providers/key-check';
import type { OpenRouterProvider } from '../providers/openrouter';

export interface CredentialDeps {
  /** CREDENTIALS_ENCRYPTION_KEY, decoded. */
  key: Buffer;
  anthropic: AnthropicProvider;
  openrouter: Pick<OpenRouterProvider, 'checkKey'>;
}

const NOTHING_SAVED = 'Nothing was saved.';

type Refusals = Record<Exclude<KeyCheckResult, 'ok'>, { status: number; message: string }>;

/** Why a key wasn't stored, for each failed check, in each provider's words. */
const REFUSALS: Record<Provider, Refusals> = {
  anthropic: {
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
  },
  openrouter: {
    rejected: {
      status: 400,
      message: `OpenRouter didn't accept this key. Check that you copied all of it, and that it hasn't been deleted or disabled. ${NOTHING_SAVED}`,
    },
    forbidden: {
      status: 400,
      message: `That's an OpenRouter management key, which can't generate images. Create a regular API key on OpenRouter's Keys page. ${NOTHING_SAVED}`,
    },
    rate_limited: {
      status: 503,
      message: `OpenRouter is rate limiting this key right now. Try again in a minute. ${NOTHING_SAVED}`,
    },
    unreachable: {
      status: 502,
      message: `Couldn't reach OpenRouter to check the key. Try again in a moment. ${NOTHING_SAVED}`,
    },
  },
};

const STATUS_NAMES: Record<number, string> = {
  400: 'Bad Request',
  404: 'Not Found',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
};

function refuse(reply: FastifyReply, status: number, message: string): FastifyReply {
  // Answered here rather than thrown, so a refusal never reaches the error logger.
  return reply.code(status).send({ statusCode: status, error: STATUS_NAMES[status], message });
}

/** The `:provider` of the path, or null (answered 404) for anything we don't store. */
function providerOf(request: FastifyRequest): Provider | null {
  const parsed = providerSchema.safeParse((request.params as { provider?: unknown }).provider);
  return parsed.success ? parsed.data : null;
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

  app.put('/api/me/credentials/:provider', { preHandler }, async (request, reply) => {
    const { user } = sessionOf(request);
    const provider = providerOf(request);
    if (provider === null) return refuse(reply, 404, 'No such key');

    const parsed = saveProviderKeyRequestSchemas[provider].safeParse(request.body);
    if (!parsed.success) return sendValidationError(reply, parsed.error);
    const { apiKey } = parsed.data;

    const result = await credentials[provider].checkKey(apiKey);
    if (result !== 'ok') {
      const refusal = REFUSALS[provider][result];
      return refuse(reply, refusal.status, refusal.message);
    }

    return saveProviderKey(db, credentials.key, user.id, provider, apiKey);
  });

  app.delete('/api/me/credentials/:provider', { preHandler }, async (request, reply) => {
    const { user } = sessionOf(request);
    const provider = providerOf(request);
    if (provider === null) return refuse(reply, 404, 'No such key');
    await deleteProviderKey(db, user.id, provider);
    return reply.code(204).send();
  });
}
