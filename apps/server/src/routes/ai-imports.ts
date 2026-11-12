/**
 * AI note import (F1.8, governance §10, D-27). GM only; everything but reading is refused
 * while the campaign is archived. Every campaign route here is in the isolation table in
 * `campaigns.int.test.ts`.
 *
 * POST  /api/campaigns/:campaignId/imports/estimate   what this request would cost (free)
 * POST  /api/campaigns/:campaignId/imports            start an import → 202, `running`
 * GET   /api/campaigns/:campaignId/imports            the campaign's imports, newest first
 * GET   /api/campaigns/:campaignId/imports/:importId  one import with its proposals (polled)
 * PATCH /api/campaigns/:campaignId/imports/:importId/proposals/:proposalId
 * POST  /api/campaigns/:campaignId/imports/:importId/accept-all
 * POST  /api/campaigns/:campaignId/imports/:importId/commit
 * POST  /api/campaigns/:campaignId/imports/:importId/discard
 * GET   /api/me/usage                                 the GM's imports, tokens and cost
 *
 * The model call runs in the background (`ai-import/runner.ts`); the browser polls the
 * import until it is `ready` or `failed`. The GM's notes and the model's answer are never
 * logged, and the GM's key goes only into the outgoing call.
 */
import { randomUUID } from 'node:crypto';

import { IMPORT_PROMPT_VERSION } from '@stagehand/prompts';
import {
  AI_IMPORT_MODEL,
  commitImportResponseSchema,
  emptyTokenUsage,
  estimateImportCostUsd,
  IMPORT_ERROR_MESSAGES,
  importDetailSchema,
  importEstimateResponseSchema,
  importListResponseSchema,
  importSummarySchema,
  patchProposalRequestSchema,
  patchProposalResponseSchema,
  startImportRequestSchema,
  usageResponseSchema,
  type StartImportRequest,
} from '@stagehand/shared';
import type { FastifyInstance, FastifyReply } from 'fastify';

import { generateImport, type GenerateResult } from '../ai-import/generate';
import { buildUserMessage } from '../ai-import/prompt';
import type { ImportRunner } from '../ai-import/runner';
import type { Auth } from '../auth/auth';
import { requireSession, sessionOf } from '../auth/routes';
import {
  acceptAllProposals,
  commitImport,
  discardImport,
  finishImport,
  getImport,
  listImports,
  listUsage,
  patchProposal,
  prepareImport,
  startImport,
} from '../campaigns/ai-imports';
import { campaignOf, memberOnly, uuidParam } from '../campaigns/guard';
import { assertGm, assertWritable } from '../campaigns/scope';
import { CredentialUnreadableError } from '../credentials/crypto';
import { getProviderKey } from '../credentials/store';
import type { Database } from '../db/client';
import { sendValidationError } from '../http/errors';
import type { ProviderFailure } from '../providers/anthropic';

import type { CredentialDeps } from './provider-credentials';

export interface ImportDeps {
  /** The filled import prompt (`loadImportSystemPrompt`), read once at startup. */
  systemPrompt: string;
  runner: ImportRunner;
}

const NO_KEY = 'Add your Anthropic API key in Settings before importing.';
const UNREADABLE_KEY =
  "Your stored Anthropic key can't be read any more. Enter it again in Settings.";

/** How a failed token count is answered: the same words an import that failed would show. */
const COUNT_REFUSALS: Record<ProviderFailure['status'], { status: number; message: string }> = {
  rejected: { status: 409, message: IMPORT_ERROR_MESSAGES.key_rejected },
  forbidden: { status: 409, message: IMPORT_ERROR_MESSAGES.key_forbidden },
  rate_limited: { status: 503, message: IMPORT_ERROR_MESSAGES.rate_limited },
  unreachable: { status: 502, message: IMPORT_ERROR_MESSAGES.unreachable },
  bad_request: { status: 502, message: IMPORT_ERROR_MESSAGES.bad_request },
  aborted: { status: 503, message: IMPORT_ERROR_MESSAGES.interrupted },
};

const STATUS_NAMES: Record<number, string> = {
  409: 'Conflict',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
};

function refuse(reply: FastifyReply, status: number, message: string): FastifyReply {
  // Answered here rather than thrown, so a refusal never reaches the error logger.
  return reply.code(status).send({ statusCode: status, error: STATUS_NAMES[status], message });
}

export function registerImportRoutes(
  app: FastifyInstance,
  deps: { auth: Auth; db: Database; credentials: CredentialDeps; imports: ImportDeps },
): void {
  const { db, credentials, imports } = deps;
  const preHandler = memberOnly(deps.auth, db);
  const importId = (request: Parameters<typeof uuidParam>[0]) =>
    uuidParam(request, 'importId', 'Import not found');

  /** The GM's decrypted key, or the reason there is none to use. */
  async function keyOf(userId: string): Promise<{ apiKey: string } | { refusal: string }> {
    try {
      const apiKey = await getProviderKey(db, credentials.key, userId, 'anthropic');
      return apiKey === null ? { refusal: NO_KEY } : { apiKey };
    } catch (error) {
      if (error instanceof CredentialUnreadableError) return { refusal: UNREADABLE_KEY };
      throw error;
    }
  }

  const promptInput = (request: StartImportRequest) => ({
    mode: request.mode,
    text: request.text,
    targetTypes: request.targetTypes ?? null,
  });

  app.post(
    '/api/campaigns/:campaignId/imports/estimate',
    { preHandler },
    async (request, reply) => {
      const scope = campaignOf(request);
      assertGm(scope);
      assertWritable(scope);

      const parsed = startImportRequestSchema.safeParse(request.body);
      if (!parsed.success) return sendValidationError(reply, parsed.error);
      const key = await keyOf(scope.userId);
      if ('refusal' in key) return refuse(reply, 409, key.refusal);

      const { pack, levels } = await prepareImport(db, scope, parsed.data);
      const count = await credentials.anthropic.countImportTokens({
        apiKey: key.apiKey,
        system: imports.systemPrompt,
        user: buildUserMessage({ ...promptInput(parsed.data), pack }),
      });
      if (count.status !== 'ok') {
        const refusal = COUNT_REFUSALS[count.status];
        return refuse(reply, refusal.status, refusal.message);
      }
      return importEstimateResponseSchema.parse({
        model: AI_IMPORT_MODEL,
        inputTokens: count.inputTokens,
        context: levels,
        estimatedCostUsd: estimateImportCostUsd(
          AI_IMPORT_MODEL,
          count.inputTokens,
          parsed.data.text.length,
        ),
      });
    },
  );

  app.post('/api/campaigns/:campaignId/imports', { preHandler }, async (request, reply) => {
    const scope = campaignOf(request);
    assertGm(scope);
    assertWritable(scope);

    const parsed = startImportRequestSchema.safeParse(request.body);
    if (!parsed.success) return sendValidationError(reply, parsed.error);
    const key = await keyOf(scope.userId);
    if ('refusal' in key) return refuse(reply, 409, key.refusal);

    const { pack } = await prepareImport(db, scope, parsed.data);
    const started = await startImport(db, scope, parsed.data, {
      promptVersion: IMPORT_PROMPT_VERSION,
      model: AI_IMPORT_MODEL,
    });

    const ids = { importId: started.id, campaignId: scope.campaignId };
    imports.runner.run(async (signal) => {
      let result: GenerateResult;
      try {
        result = await generateImport({
          provider: credentials.anthropic,
          apiKey: key.apiKey,
          systemPrompt: imports.systemPrompt,
          ...promptInput(parsed.data),
          pack,
          newId: randomUUID,
          signal,
        });
      } catch (error) {
        // Only the kind of error is logged: its message could quote the notes.
        app.log.error(
          { importId: ids.importId, errorName: error instanceof Error ? error.name : 'unknown' },
          'ai import failed',
        );
        result = {
          ok: false,
          error: 'internal',
          details: [],
          model: AI_IMPORT_MODEL,
          usage: emptyTokenUsage(),
          attempts: 0,
        };
      }
      await finishImport(db, ids, result);
    });

    return reply.code(202).send(importSummarySchema.parse(started));
  });

  app.get('/api/campaigns/:campaignId/imports', { preHandler }, async (request) => {
    const scope = campaignOf(request);
    assertGm(scope);
    return importListResponseSchema.parse({ imports: await listImports(db, scope) });
  });

  app.get('/api/campaigns/:campaignId/imports/:importId', { preHandler }, async (request) => {
    const scope = campaignOf(request);
    assertGm(scope);
    return importDetailSchema.parse(await getImport(db, scope, importId(request)));
  });

  app.patch(
    '/api/campaigns/:campaignId/imports/:importId/proposals/:proposalId',
    { preHandler },
    async (request, reply) => {
      const scope = campaignOf(request);
      assertGm(scope);
      assertWritable(scope);
      const proposalId = uuidParam(request, 'proposalId', 'Proposal not found');

      const parsed = patchProposalRequestSchema.safeParse(request.body);
      if (!parsed.success) return sendValidationError(reply, parsed.error);

      return patchProposalResponseSchema.parse(
        await patchProposal(db, scope, importId(request), proposalId, parsed.data),
      );
    },
  );

  app.post(
    '/api/campaigns/:campaignId/imports/:importId/accept-all',
    { preHandler },
    async (request) => {
      const scope = campaignOf(request);
      assertGm(scope);
      assertWritable(scope);
      return importDetailSchema.parse(await acceptAllProposals(db, scope, importId(request)));
    },
  );

  app.post(
    '/api/campaigns/:campaignId/imports/:importId/commit',
    { preHandler },
    async (request) => {
      const scope = campaignOf(request);
      assertGm(scope);
      assertWritable(scope);
      return commitImportResponseSchema.parse(await commitImport(db, scope, importId(request)));
    },
  );

  app.post(
    '/api/campaigns/:campaignId/imports/:importId/discard',
    { preHandler },
    async (request) => {
      const scope = campaignOf(request);
      assertGm(scope);
      assertWritable(scope);
      return importSummarySchema.parse(await discardImport(db, scope, importId(request)));
    },
  );

  // User-scoped, like the credentials routes: a GM's own imports across their campaigns.
  app.get('/api/me/usage', { preHandler: requireSession(deps.auth) }, async (request) => {
    const { user } = sessionOf(request);
    return usageResponseSchema.parse(await listUsage(db, user.id));
  });
}
