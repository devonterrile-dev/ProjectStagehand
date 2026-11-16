import {
  createRecordRequestSchema,
  recordListQuerySchema,
  updateRecordRequestSchemaFor,
  type RecordListResponse,
} from '@stagehand/shared';
import type { FastifyInstance } from 'fastify';

import type { Auth } from '../auth/auth';
import { campaignOf, memberOnly, uuidParam } from '../campaigns/guard';
import {
  createRecord,
  deleteRecord,
  getRecord,
  listRecords,
  recordTypeOf,
  updateRecord,
} from '../campaigns/records';
import { setRecordRevealed } from '../campaigns/play-sessions';
import { listBacklinks } from '../campaigns/record-links';
import { assertGm, assertWritable } from '../campaigns/scope';
import type { Database } from '../db/client';
import { sendValidationError } from '../http/errors';
import type { PlayLive } from '../play/socket';

/**
 * Narrative records (F1.3): list, create, read, partial update and delete, plus each
 * record's backlinks (F1.5). A record's own links are read and written with the record.
 * Reveal and Un-reveal (F3.4, §7) say whether players may have it; what players then see of a
 * revealed record arrives with the player journal (F3.5). GM only. Every route here is
 * campaign-scoped: see the isolation table in `campaigns.int.test.ts`.
 */
export function registerRecordRoutes(
  app: FastifyInstance,
  deps: { auth: Auth; db: Database; live: PlayLive },
): void {
  const preHandler = memberOnly(deps.auth, deps.db);
  const recordId = (request: Parameters<typeof uuidParam>[0]) =>
    uuidParam(request, 'recordId', 'Record not found');

  app.get('/api/campaigns/:campaignId/records', { preHandler }, async (request, reply) => {
    const scope = campaignOf(request);
    assertGm(scope);

    const query = recordListQuerySchema.safeParse(request.query);
    if (!query.success) return sendValidationError(reply, query.error);

    const response: RecordListResponse = {
      records: await listRecords(deps.db, scope, query.data),
    };
    return response;
  });

  app.post('/api/campaigns/:campaignId/records', { preHandler }, async (request, reply) => {
    const scope = campaignOf(request);
    assertGm(scope);
    assertWritable(scope);

    const parsed = createRecordRequestSchema.safeParse(request.body);
    if (!parsed.success) return sendValidationError(reply, parsed.error);

    return reply.code(201).send(await createRecord(deps.db, scope, parsed.data));
  });

  app.get('/api/campaigns/:campaignId/records/:recordId', { preHandler }, async (request) => {
    const scope = campaignOf(request);
    assertGm(scope);
    return getRecord(deps.db, scope, recordId(request));
  });

  // Everything that points at the record. Reading still works while archived.
  app.get(
    '/api/campaigns/:campaignId/records/:recordId/backlinks',
    { preHandler },
    async (request) => {
      const scope = campaignOf(request);
      assertGm(scope);
      return listBacklinks(deps.db, scope, recordId(request));
    },
  );

  // The body's `fields` and `links` are checked against the record's own type, so the type
  // is read first. It never changes, so reading it outside the update's transaction is safe.
  app.patch(
    '/api/campaigns/:campaignId/records/:recordId',
    { preHandler },
    async (request, reply) => {
      const scope = campaignOf(request);
      assertGm(scope);
      assertWritable(scope);
      const id = recordId(request);

      const type = await recordTypeOf(deps.db, scope, id);
      const parsed = updateRecordRequestSchemaFor(type).safeParse(request.body);
      if (!parsed.success) return sendValidationError(reply, parsed.error);

      return updateRecord(deps.db, scope, id, parsed.data);
    },
  );

  // Reveal (§7): players may have the record from now on; Un-reveal undoes a mistake. During a
  // session the desk's marks change too, so the stage is sent again.
  for (const [action, revealed] of [
    ['reveal', true],
    ['unreveal', false],
  ] as const) {
    app.post(
      `/api/campaigns/:campaignId/records/:recordId/${action}`,
      { preHandler },
      async (request) => {
        const scope = campaignOf(request);
        assertGm(scope);
        assertWritable(scope);
        const id = recordId(request);

        await setRecordRevealed(deps.db, scope, id, revealed);
        deps.live.stageChanged(scope);
        return getRecord(deps.db, scope, id);
      },
    );
  }

  app.delete(
    '/api/campaigns/:campaignId/records/:recordId',
    { preHandler },
    async (request, reply) => {
      const scope = campaignOf(request);
      assertGm(scope);
      assertWritable(scope);

      await deleteRecord(deps.db, scope, recordId(request));
      return reply.code(204).send();
    },
  );
}
