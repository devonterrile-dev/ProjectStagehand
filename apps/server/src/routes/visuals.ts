/**
 * Generate visual (F2.3, governance §11, D-42). GM only, except the image route; starting a try
 * and choosing one are refused while the campaign is archived. Every campaign route here is in
 * the isolation table in `campaigns.int.test.ts`.
 *
 * GET    …/records/:recordId/visuals                  the image in use and the drafts
 * POST   …/records/:recordId/visuals                  a new image → 202 `generating`
 * POST   …/records/:recordId/visuals/:assetId/revise  Regenerate with notes → 202 (F2.5)
 * POST   …/records/:recordId/visuals/upload           the GM's own image as the body → 201
 *        ?kind=…&finished=true                        with the visuals, a draft (F2.6, D-70)
 * PUT    …/records/:recordId/visual                   "Use this" / "Replace"
 * DELETE …/records/:recordId/visuals/:assetId         "Discard", "Keep current", "Keep new",
 *                                                     "Go back", dismiss a failed try (F2.5)
 * (the same six under …/characters/:characterId for a PC; … is /api/campaigns/:campaignId)
 * GET    /api/campaigns/:campaignId/assets/:assetId/image  the stage's version (F2.4), or the
 *        ?v=original for the model's own                    original until it is made
 *        A player may load only the stage's version of an image the live stage is showing them
 *        at that moment (F3.3, D-50); everything else here is the GM's.
 *
 * The image is made in the background (`visuals/queue.ts`); the browser polls the list while a
 * try is `generating`. The prompt is built here from the record and the style bible, stored
 * with the asset, and never logged; nor are a revision's notes. Review rules: D-44.
 */
import {
  assetImageQuerySchema,
  generateVisualRequestSchema,
  IMAGE_MODEL,
  isCutoutKind,
  reviseVisualRequestSchema,
  uploadVisualQuerySchema,
  useVisualRequestSchema,
  VISUAL_UPLOAD_MAX_BYTES,
  VISUAL_UPLOAD_MESSAGES,
  VISUAL_UPLOAD_TYPES,
  visualKindsFor,
  type AssetKind,
  type VisualSubject,
} from '@stagehand/shared';
import type { StyleBible } from '@stagehand/style-bible';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import type { Auth } from '../auth/auth';
import { campaignOf, memberOnly, uuidParam } from '../campaigns/guard';
import { playerCanSeeAsset } from '../campaigns/play-sessions';
import { assertGm, assertWritable, type CampaignScope } from '../campaigns/scope';
import {
  assetImageOf,
  discardVisual,
  finishVisual,
  listVisuals,
  loadVisualSource,
  revisionBaseOf,
  startVisual,
  uploadVisual,
  useVisual,
  type StartVisualInput,
  type VisualOwner,
} from '../campaigns/visuals';
import { CredentialUnreadableError } from '../credentials/crypto';
import { getProviderKey } from '../credentials/store';
import type { Database } from '../db/client';
import { httpError, sendValidationError } from '../http/errors';
import { defaultImageProcessor } from '../visuals/job';
import { PROCESSING_VERSION, ProcessingError } from '../visuals/process';
import { revisionPrompt, visualPrompt } from '../visuals/prompt';
import type { VisualQueue } from '../visuals/queue';
import { extensionOf, type AssetStorage } from '../visuals/storage';
import { readUpload, UPLOAD_MEDIA_TYPE, UploadError } from '../visuals/upload';

export interface VisualDeps {
  queue: VisualQueue;
  storage: AssetStorage;
  /** The style bible new assets are made with, read once at startup. */
  bible: StyleBible;
}

export const NO_OPENROUTER_KEY = 'Add your OpenRouter API key in Settings before making images.';
/**
 * The body limit of an upload route: a little over the real limit, so an image just over it
 * gets our own message rather than Fastify's.
 */
const UPLOAD_BODY_LIMIT = VISUAL_UPLOAD_MAX_BYTES + 1024 * 1024;

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

  /** The settings a new asset of this kind is made with. */
  function made(kind: AssetKind): Omit<StartVisualInput, 'kind' | 'prompt' | 'revision'> {
    const settings = visuals.bible.style.kinds[kind];
    return {
      model: IMAGE_MODEL,
      styleBibleVersion: visuals.bible.version,
      quality: settings.quality,
      aspectRatio: settings.aspectRatio,
    };
  }

  /** Records the try, queues its job, and answers 202 with it. */
  async function launch(
    reply: FastifyReply,
    scope: CampaignScope,
    owner: VisualOwner,
    input: StartVisualInput,
  ): Promise<FastifyReply> {
    const started = await startVisual(db, scope, owner, input);
    try {
      await visuals.queue.enqueue(started.id);
    } catch (error) {
      await finishVisual(db, started.id, { ok: false, errorCode: 'internal' });
      throw error;
    }
    return reply.code(202).send(started);
  }

  /** The routes of one owner type: records or characters. */
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

      return launch(reply, scope, owner, {
        kind: assetKind,
        prompt: visualPrompt(visuals.bible, assetKind, source),
        ...made(assetKind),
      });
    });

    app.post(`${path}/visuals/:assetId/revise`, { preHandler }, async (request, reply) => {
      const scope = campaignOf(request);
      assertGm(scope);
      assertWritable(scope);
      const owner = ownerOf(request);
      const assetId = uuidParam(request, 'assetId', 'Image not found');

      const parsed = reviseVisualRequestSchema.safeParse(request.body);
      if (!parsed.success) return sendValidationError(reply, parsed.error);
      const { source } = await loadVisualSource(db, scope, owner);
      const { kind } = await revisionBaseOf(db, scope, owner, assetId);

      const noKey = await hasKey(scope.userId);
      if (noKey !== null) return refuse(reply, noKey);

      const { notes } = parsed.data;
      return launch(reply, scope, owner, {
        kind,
        prompt: revisionPrompt(visuals.bible, kind, source, notes),
        ...made(kind),
        revision: { fromId: assetId, notes },
      });
    });

    app.put(`${path}/visual`, { preHandler }, async (request, reply) => {
      const scope = campaignOf(request);
      assertGm(scope);
      assertWritable(scope);
      const owner = ownerOf(request);
      const parsed = useVisualRequestSchema.safeParse(request.body);
      if (!parsed.success) return sendValidationError(reply, parsed.error);
      return useVisual(db, visuals.storage, scope, owner, parsed.data.assetId);
    });

    app.delete(`${path}/visuals/:assetId`, { preHandler }, async (request) => {
      const scope = campaignOf(request);
      assertGm(scope);
      assertWritable(scope);
      const owner = ownerOf(request);
      const assetId = uuidParam(request, 'assetId', 'Image not found');
      return discardVisual(db, visuals.storage, scope, owner, assetId);
    });
  }

  const owners: [string, (request: FastifyRequest) => VisualOwner][] = [
    [
      '/api/campaigns/:campaignId/records/:recordId',
      (request) => ({ recordId: uuidParam(request, 'recordId', 'Record not found') }),
    ],
    [
      '/api/campaigns/:campaignId/characters/:characterId',
      (request) => ({ characterId: uuidParam(request, 'characterId', 'Character not found') }),
    ],
  ];
  for (const [path, ownerOf] of owners) ownerRoutes(path, ownerOf);

  // Uploads (F2.6) take the image itself as the body. The parser for image bodies lives in
  // this child plugin only, so no other route accepts one.
  void app.register((uploads, _options, done) => {
    uploads.addContentTypeParser(
      [...VISUAL_UPLOAD_TYPES],
      { parseAs: 'buffer', bodyLimit: UPLOAD_BODY_LIMIT },
      (_request, body, done) => {
        done(null, body);
      },
    );
    for (const [path, ownerOf] of owners) {
      uploads.post(
        `${path}/visuals/upload`,
        { preHandler, bodyLimit: UPLOAD_BODY_LIMIT },
        async (request, reply) => {
          const scope = campaignOf(request);
          assertGm(scope);
          assertWritable(scope);
          const owner = ownerOf(request);

          const query = uploadVisualQuerySchema.safeParse(request.query);
          if (!query.success) return sendValidationError(reply, query.error);
          const { source } = await loadVisualSource(db, scope, owner);
          const chosen = kindFor(source.subject, query.data.kind);
          if ('problem' in chosen) {
            return reply
              .code(400)
              .send({ error: 'Bad Request', issues: [{ path: 'kind', message: chosen.problem }] });
          }
          const { kind } = chosen;

          const body: unknown = request.body;
          if (!Buffer.isBuffer(body)) throw httpError(415, VISUAL_UPLOAD_MESSAGES.notImage);
          if (body.length > VISUAL_UPLOAD_MAX_BYTES) {
            throw httpError(413, VISUAL_UPLOAD_MESSAGES.tooBig);
          }
          // A backdrop is only cropped and sized, so "finished" changes nothing for it.
          const finished = query.data.finished && isCutoutKind(kind);

          let original: Buffer;
          let processed;
          try {
            original = await readUpload(body);
            processed = await defaultImageProcessor(
              original,
              kind,
              finished ? 'finished' : 'upload',
            );
          } catch (error) {
            if (error instanceof UploadError) throw httpError(400, error.message);
            if (error instanceof ProcessingError) {
              throw httpError(400, VISUAL_UPLOAD_MESSAGES.empty);
            }
            throw error;
          }

          const visualsNow = await uploadVisual(db, visuals.storage, scope, owner, {
            kind,
            finished,
            original: {
              data: original,
              mediaType: UPLOAD_MEDIA_TYPE,
              extension: extensionOf(UPLOAD_MEDIA_TYPE),
            },
            processed,
            processingVersion: PROCESSING_VERSION,
          });
          return reply.code(201).send(visualsNow);
        },
      );
    }
    done();
  });

  app.get(
    '/api/campaigns/:campaignId/assets/:assetId/image',
    { preHandler },
    async (request, reply) => {
      const scope = campaignOf(request);
      const assetId = uuidParam(request, 'assetId', 'Image not found');
      const query = assetImageQuerySchema.safeParse(request.query);
      if (!query.success) return sendValidationError(reply, query.error);

      const notFound = () =>
        reply.code(404).send({ statusCode: 404, error: 'Not Found', message: 'Image not found' });
      // A player gets the stage's version of what the live stage is showing them right now
      // (F3.3), and nothing else: any other image is answered as if it didn't exist.
      const isPlayer = scope.role !== 'gm';
      if (isPlayer && !(await playerCanSeeAsset(db, scope, assetId))) return notFound();

      const { key, mediaType } = await assetImageOf(db, scope, assetId, query.data.v, {
        stageOnly: isPlayer,
      });
      const stream = await visuals.storage.open(key);
      if (stream === null) return notFound();
      // An asset's files never change under a URL: a remade processed image comes with a new
      // `?p=<version>`. So the browser may keep them; `private` keeps them out of shared caches
      // (Cloudflare), since not everyone may see them. The unversioned URL may fall back to the
      // original before processing, so it is not kept.
      const cache =
        query.data.v === 'original' || query.data.p !== undefined
          ? 'private, max-age=31536000, immutable'
          : 'private, no-cache';
      return reply.header('content-type', mediaType).header('cache-control', cache).send(stream);
    },
  );
}
