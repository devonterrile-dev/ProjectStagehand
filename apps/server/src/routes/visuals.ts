/**
 * Generate visual (F2.3, governance §11, D-42). GM only; starting a try and choosing one are
 * refused while the campaign is archived. Every campaign route here is in the isolation table
 * in `campaigns.int.test.ts`.
 *
 * GET  /api/campaigns/:campaignId/records/:recordId/visuals        the tries, newest first
 * POST /api/campaigns/:campaignId/records/:recordId/visuals        start one → 202 `generating`
 * PUT  /api/campaigns/:campaignId/records/:recordId/visual         "Use this one"
 * GET  /api/campaigns/:campaignId/characters/:characterId/visuals  (the same for a PC)
 * POST /api/campaigns/:campaignId/characters/:characterId/visuals
 * PUT  /api/campaigns/:campaignId/characters/:characterId/visual
 * GET  /api/campaigns/:campaignId/assets/:assetId/image            the image file
 *
 * The image is made in the background (`visuals/queue.ts`); the browser polls the list while a
 * try is `generating`. The prompt is built here from the record and the style bible, stored
 * with the asset, and never logged.
 */
import {
  generateVisualRequestSchema,
  IMAGE_MODEL,
  useVisualRequestSchema,
  visualKindsFor,
  type AssetKind,
  type VisualSubject,
} from '@stagehand/shared';
import type { StyleBible } from '@stagehand/style-bible';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import type { Auth } from '../auth/auth';
import { campaignOf, memberOnly, uuidParam } from '../campaigns/guard';
import { assertGm, assertWritable } from '../campaigns/scope';
import {
  assetImageOf,
  finishVisual,
  listVisuals,
  loadVisualSource,
  startVisual,
  useVisual,
  type VisualOwner,
} from '../campaigns/visuals';
import { CredentialUnreadableError } from '../credentials/crypto';
import { getProviderKey } from '../credentials/store';
import type { Database } from '../db/client';
import { sendValidationError } from '../http/errors';
import { visualPrompt } from '../visuals/prompt';
import type { VisualQueue } from '../visuals/queue';
import type { AssetStorage } from '../visuals/storage';

export interface VisualDeps {
  queue: VisualQueue;
  storage: AssetStorage;
  /** The style bible new assets are made with, read once at startup. */
  bible: StyleBible;
}

export const NO_OPENROUTER_KEY = 'Add your OpenRouter API key in Settings before making images.';
const UNREADABLE_KEY =
  "Your stored OpenRouter key can't be read any more. Enter it again in Settings.";

function refuse(reply: FastifyReply, message: string): FastifyReply {
  // Answered here rather than thrown, so a missing key never reaches the error logger.
  return reply.code(409).send({ statusCode: 409, error: 'Conflict', message });
}

/** The asset kind to draw: the one asked for, which must be allowed, or the only one. */
function kindFor(
  subject: VisualSubject,
  asked: AssetKind | undefined,
): { kind: AssetKind } | { problem: string } {
  const kinds = visualKindsFor(subject);
  if (asked === undefined) {
    const [only] = kinds;
    return kinds.length === 1 && only !== undefined
      ? { kind: only }
      : { problem: 'Choose whether this is a humanoid or a monster' };
  }
  return kinds.includes(asked) ? { kind: asked } : { problem: `This can't be drawn as a ${asked}` };
}

export function registerVisualRoutes(
  app: FastifyInstance,
  deps: { auth: Auth; db: Database; credentialsKey: Buffer; visuals: VisualDeps },
): void {
  const { db, visuals } = deps;
  const preHandler = memberOnly(deps.auth, db);

  async function hasKey(userId: string): Promise<string | null> {
    try {
      const key = await getProviderKey(db, deps.credentialsKey, userId, 'openrouter');
      return key === null ? NO_OPENROUTER_KEY : null;
    } catch (error) {
      if (error instanceof CredentialUnreadableError) return UNREADABLE_KEY;
      throw error;
    }
  }

  /** The three routes of one owner type: records or characters. */
  function ownerRoutes(path: string, ownerOf: (request: FastifyRequest) => VisualOwner): void {
    app.get(`${path}/visuals`, { preHandler }, async (request) => {
      const scope = campaignOf(request);
      assertGm(scope);
      return listVisuals(db, scope, ownerOf(request));
    });

    app.post(`${path}/visuals`, { preHandler }, async (request, reply) => {
      const scope = campaignOf(request);
      assertGm(scope);
      assertWritable(scope);
      const owner = ownerOf(request);

      const parsed = generateVisualRequestSchema.safeParse(request.body ?? {});
      if (!parsed.success) return sendValidationError(reply, parsed.error);
      const { source } = await loadVisualSource(db, scope, owner);
      const chosen = kindFor(source.subject, parsed.data.kind);
      if ('problem' in chosen) {
        return reply
          .code(400)
          .send({ error: 'Bad Request', issues: [{ path: 'kind', message: chosen.problem }] });
      }
      const assetKind = chosen.kind;

      const noKey = await hasKey(scope.userId);
      if (noKey !== null) return refuse(reply, noKey);

      const settings = visuals.bible.style.kinds[assetKind];
      const started = await startVisual(db, scope, owner, {
        kind: assetKind,
        prompt: visualPrompt(visuals.bible, assetKind, source),
        model: IMAGE_MODEL,
        styleBibleVersion: visuals.bible.version,
        quality: settings.quality,
        aspectRatio: settings.aspectRatio,
      });
      try {
        await visuals.queue.enqueue(started.id);
      } catch (error) {
        await finishVisual(db, started.id, { ok: false, errorCode: 'internal' });
        throw error;
      }
      return reply.code(202).send(started);
    });

    app.put(`${path}/visual`, { preHandler }, async (request, reply) => {
      const scope = campaignOf(request);
      assertGm(scope);
      assertWritable(scope);
      const owner = ownerOf(request);
      const parsed = useVisualRequestSchema.safeParse(request.body);
      if (!parsed.success) return sendValidationError(reply, parsed.error);
      return useVisual(db, scope, owner, parsed.data.assetId);
    });
  }

  ownerRoutes('/api/campaigns/:campaignId/records/:recordId', (request) => ({
    recordId: uuidParam(request, 'recordId', 'Record not found'),
  }));
  ownerRoutes('/api/campaigns/:campaignId/characters/:characterId', (request) => ({
    characterId: uuidParam(request, 'characterId', 'Character not found'),
  }));

  app.get(
    '/api/campaigns/:campaignId/assets/:assetId/image',
    { preHandler },
    async (request, reply) => {
      const scope = campaignOf(request);
      assertGm(scope);
      const assetId = uuidParam(request, 'assetId', 'Image not found');
      const { key, mediaType } = await assetImageOf(db, scope, assetId);
      const stream = await visuals.storage.open(key);
      if (stream === null) {
        return reply
          .code(404)
          .send({ statusCode: 404, error: 'Not Found', message: 'Image not found' });
      }
      // An asset's original never changes, so the browser may keep it; `private` keeps it out
      // of shared caches (Cloudflare), since only the GM may see it.
      return reply
        .header('content-type', mediaType)
        .header('cache-control', 'private, max-age=31536000, immutable')
        .send(stream);
    },
  );
}
