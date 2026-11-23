/**
 * The visuals part of the fake API (F2.3, F2.5): tries that start `generating` and finish on
 * the next poll (pending, or failed for a subject whose name contains `FAIL_VISUAL_WORD`), and
 * review: use, discard and regenerate with notes, following the server's rules and messages
 * (`apps/server/src/campaigns/visuals.ts`, D-44). Uploads (F2.6) become finished drafts at once;
 * an empty file is refused as not an image.
 */
import {
  generateVisualRequestSchema,
  isCutoutKind,
  isVisualSubject,
  reviseVisualRequestSchema,
  uploadVisualQuerySchema,
  useVisualRequestSchema,
  VISUAL_UPLOAD_MAX_BYTES,
  VISUAL_UPLOAD_MESSAGES,
  VISUAL_UPLOAD_TYPES,
  visualKindsFor,
  type AssetKind,
  type AssetSummary,
  type Campaign,
  type CampaignRecord,
  type CharacterSheet,
} from '@stagehand/shared';

export const NO_OPENROUTER_KEY_MESSAGE =
  'Add your OpenRouter API key in Settings before making images.';
/** A record or PC whose name contains this word gets a failed try (`bad_request`). */
export const FAIL_VISUAL_WORD = 'Cursed';
/** What every finished try cost. */
export const VISUAL_COST = 0.0612;
/** A record or PC whose name contains this word gets a try that isn't post-processed (yet). */
export const UNPROCESSED_VISUAL_WORD = 'Raw';
/** The stage version every other finished try gets (F2.4). */
export const PROCESSED_VISUAL = { width: 683, height: 1024, version: 1 } as const;
/** The stage version a finished upload keeps (F2.6): its own size. */
export const FINISHED_UPLOAD = { width: 300, height: 400, version: 1 } as const;

export const WAIT_MESSAGE = 'An image for this is already being made. Wait for it to finish.';
export const REVIEW_FIRST_MESSAGE = 'Use or discard the new image first.';
export const COMPARE_FIRST_MESSAGE = 'Keep the new version or go back to the old one first.';

export interface VisualsWorldOptions {
  /**
   * Tries already made, by record or PC id, oldest first. The one in use is the owner's
   * `visualAssetId`; the rest that are generating, pending or failed are its drafts.
   */
  visuals?: Record<string, AssetSummary[]>;
}

interface Ctx {
  hasKey: () => boolean;
  refused: (status: number, message: string) => Response;
  notFound: (message: string) => Response;
}

let nextId = 0;
const id = () => {
  nextId += 1;
  return `00000000-0000-4000-a000-${String(nextId).padStart(12, '0')}`;
};

/** A finished try fixture, plus overrides. */
export function assetSummary(overrides: Partial<AssetSummary> = {}): AssetSummary {
  return {
    id: id(),
    kind: 'prop',
    status: 'pending',
    errorCode: null,
    costUsd: VISUAL_COST,
    source: 'generated',
    finished: false,
    mediaType: 'image/png',
    processed: { ...PROCESSED_VISUAL },
    revisedFromId: null,
    revisionNotes: null,
    createdAt: '2026-11-13T09:00:00.000Z',
    finishedAt: '2026-11-13T09:01:00.000Z',
    ...overrides,
  };
}

const DRAFT_STATUSES: readonly string[] = ['generating', 'pending', 'failed'];

export function visualsWorld(options: VisualsWorldOptions, ctx: Ctx) {
  const tries = new Map<string, AssetSummary[]>(
    Object.entries(options.visuals ?? {}).map(([owner, list]) => [owner, [...list]]),
  );
  /** Generating tries seen by one GET already: the next GET finishes them. */
  const polled = new Set<string>();

  const json = (body: unknown, status = 200) => Response.json(body, { status });

  function finish(owner: { name: string }, list: AssetSummary[]): void {
    for (const [index, asset] of list.entries()) {
      if (asset.status !== 'generating') continue;
      if (!polled.has(asset.id)) {
        polled.add(asset.id);
        continue;
      }
      list[index] = owner.name.includes(FAIL_VISUAL_WORD)
        ? { ...asset, status: 'failed', errorCode: 'bad_request', finishedAt: asset.createdAt }
        : {
            ...asset,
            status: 'pending',
            costUsd: VISUAL_COST,
            processed: owner.name.includes(UNPROCESSED_VISUAL_WORD)
              ? null
              : { ...PROCESSED_VISUAL },
            finishedAt: asset.createdAt,
          };
    }
  }

  function upload(
    found: Campaign,
    data: { records: CampaignRecord[]; characters: CharacterSheet[] },
    [, table, ownerId = '', queryString = '']: RegExpExecArray,
    sentBody: unknown,
  ): Response {
    if (found.role !== 'gm') return ctx.refused(403, 'Only the GM can do that');
    const owner: (CampaignRecord | CharacterSheet) | undefined =
      table === 'records'
        ? data.records.find((r) => r.id === ownerId)
        : data.characters.find((c) => c.id === ownerId);
    if (owner === undefined) {
      return ctx.notFound(table === 'records' ? 'Record not found' : 'Character not found');
    }
    const subject: string = 'type' in owner ? owner.type : 'pc';
    if (!isVisualSubject(subject)) {
      return ctx.refused(400, 'Only NPCs, Props, Items and Spots have a visual');
    }
    if (found.archivedAt !== null) return ctx.refused(409, 'Campaign is archived');
    const query = uploadVisualQuerySchema.safeParse(
      Object.fromEntries(new URLSearchParams(queryString)),
    );
    if (!query.success) return ctx.refused(400, 'Invalid request');
    const kinds = visualKindsFor(subject);
    const kind = query.data.kind ?? (kinds.length === 1 ? kinds[0] : undefined);
    if (kind === undefined || !kinds.includes(kind)) {
      return ctx.refused(400, 'Choose whether this is a humanoid or a monster');
    }
    if (
      !(sentBody instanceof Blob) ||
      !(VISUAL_UPLOAD_TYPES as readonly string[]).includes(sentBody.type)
    ) {
      return ctx.refused(415, VISUAL_UPLOAD_MESSAGES.notImage);
    }
    if (sentBody.size > VISUAL_UPLOAD_MAX_BYTES) {
      return ctx.refused(413, VISUAL_UPLOAD_MESSAGES.tooBig);
    }
    if (sentBody.size === 0) return ctx.refused(400, VISUAL_UPLOAD_MESSAGES.notImage);

    const list = tries.get(ownerId) ?? [];
    tries.set(ownerId, list);
    if (list.some((asset) => asset.status === 'generating')) {
      return ctx.refused(409, WAIT_MESSAGE);
    }
    if (list.some((asset) => asset.status === 'pending')) {
      return ctx.refused(409, REVIEW_FIRST_MESSAGE);
    }
    for (const [index, asset] of list.entries()) {
      if (asset.status === 'failed')
        list[index] = { ...asset, status: 'rejected', errorCode: null };
    }
    const finished = query.data.finished && isCutoutKind(kind);
    const now = new Date().toISOString();
    list.push(
      assetSummary({
        kind,
        source: 'uploaded',
        finished,
        costUsd: null,
        processed: finished ? { ...FINISHED_UPLOAD } : { ...PROCESSED_VISUAL },
        createdAt: now,
        finishedAt: now,
      }),
    );
    return json(
      {
        visualAssetId: owner.visualAssetId,
        inUse: list.find((asset) => asset.id === owner.visualAssetId) ?? null,
        drafts: list.filter((asset) => DRAFT_STATUSES.includes(asset.status)),
      },
      201,
    );
  }

  return {
    respond(
      found: Campaign,
      data: { records: CampaignRecord[]; characters: CharacterSheet[] },
      rest: string,
      method: string,
      rawBody: unknown,
      /** The request body as sent, for an upload's file. */
      sentBody?: unknown,
    ): Response | null {
      const uploadMatch = /^\/(records|characters)\/([^/]+)\/visuals\/upload(?:\?(.*))?$/.exec(
        rest,
      );
      if (uploadMatch !== null) {
        if (method !== 'POST') return null;
        return upload(found, data, uploadMatch, sentBody);
      }
      const match =
        /^\/(records|characters)\/([^/]+)\/(visuals|visual)(?:\/([^/]+)(\/revise)?)?$/.exec(rest);
      if (match === null) return null;
      const [, table, ownerId = '', action, assetId, revise] = match;
      if (found.role !== 'gm') return ctx.refused(403, 'Only the GM can do that');

      const owner: (CampaignRecord | CharacterSheet) | undefined =
        table === 'records'
          ? data.records.find((r) => r.id === ownerId)
          : data.characters.find((c) => c.id === ownerId);
      if (owner === undefined) {
        return ctx.notFound(table === 'records' ? 'Record not found' : 'Character not found');
      }
      const subject: string = 'type' in owner ? owner.type : 'pc';
      if (!isVisualSubject(subject)) {
        return ctx.refused(400, 'Only NPCs, Props, Items and Spots have a visual');
      }
      const list = tries.get(ownerId) ?? [];
      tries.set(ownerId, list);
      const drafts = () => list.filter((asset) => DRAFT_STATUSES.includes(asset.status));
      const pending = () => list.filter((asset) => asset.status === 'pending');
      const generating = () => list.some((asset) => asset.status === 'generating');
      const view = () => ({
        visualAssetId: owner.visualAssetId,
        inUse: list.find((asset) => asset.id === owner.visualAssetId) ?? null,
        drafts: drafts(),
      });
      const reject = (ids: readonly (string | null)[]) => {
        for (const [index, asset] of list.entries()) {
          if (ids.includes(asset.id))
            list[index] = { ...asset, status: 'rejected', errorCode: null };
        }
      };
      const start = (kind: AssetKind, revision?: { fromId: string; notes: string }) => {
        reject(list.filter((asset) => asset.status === 'failed').map((asset) => asset.id));
        const asset = assetSummary({
          kind,
          status: 'generating',
          costUsd: null,
          processed: null,
          revisedFromId: revision?.fromId ?? null,
          revisionNotes: revision?.notes ?? null,
          createdAt: new Date().toISOString(),
          finishedAt: null,
        });
        list.push(asset);
        return json(asset, 202);
      };

      if (action === 'visuals' && assetId === undefined && method === 'GET') {
        finish(owner, list);
        return json(view());
      }
      if (found.archivedAt !== null) return ctx.refused(409, 'Campaign is archived');

      if (action === 'visuals' && assetId === undefined && method === 'POST') {
        const parsed = generateVisualRequestSchema.safeParse(rawBody ?? {});
        if (!parsed.success) return ctx.refused(400, 'Invalid request');
        const kinds = visualKindsFor(subject);
        const kind = parsed.data.kind ?? (kinds.length === 1 ? kinds[0] : undefined);
        if (kind === undefined || !kinds.includes(kind)) {
          return ctx.refused(400, 'Choose whether this is a humanoid or a monster');
        }
        if (!ctx.hasKey()) return ctx.refused(409, NO_OPENROUTER_KEY_MESSAGE);
        if (generating()) return ctx.refused(409, WAIT_MESSAGE);
        if (pending().length > 0) return ctx.refused(409, REVIEW_FIRST_MESSAGE);
        return start(kind);
      }

      if (action === 'visuals' && assetId !== undefined && revise !== undefined) {
        if (method !== 'POST') return null;
        const parsed = reviseVisualRequestSchema.safeParse(rawBody);
        if (!parsed.success) return ctx.refused(400, 'Say what to change');
        const base = list.find(
          (asset) =>
            asset.id === assetId && (asset.status === 'pending' || asset.status === 'approved'),
        );
        if (base === undefined) return ctx.notFound('Image not found');
        if (!ctx.hasKey()) return ctx.refused(409, NO_OPENROUTER_KEY_MESSAGE);
        if (generating()) return ctx.refused(409, WAIT_MESSAGE);
        const waiting = pending();
        const fromDraft = waiting.length === 1 && waiting[0]?.id === base.id;
        const fromInUse = waiting.length === 0 && base.id === owner.visualAssetId;
        if (!fromDraft && !fromInUse) {
          return ctx.refused(
            409,
            waiting.length > 1 ? COMPARE_FIRST_MESSAGE : REVIEW_FIRST_MESSAGE,
          );
        }
        return start(base.kind, { fromId: base.id, notes: parsed.data.notes });
      }

      if (action === 'visuals' && assetId !== undefined && method === 'DELETE') {
        const asset = list.find((a) => a.id === assetId);
        if (asset === undefined) return ctx.notFound('Image not found');
        if (asset.status === 'rejected') return json(view());
        if (asset.id === owner.visualAssetId || asset.status === 'approved') {
          return ctx.refused(409, 'This is the image in use. Replace it with a new one instead.');
        }
        if (generating()) return ctx.refused(409, WAIT_MESSAGE);
        reject([asset.id]);
        return json(view());
      }

      if (action === 'visual' && assetId === undefined && method === 'PUT') {
        const parsed = useVisualRequestSchema.safeParse(rawBody);
        if (!parsed.success) return ctx.refused(400, 'Invalid request');
        const index = list.findIndex((asset) => asset.id === parsed.data.assetId);
        const asset = list[index];
        if (asset === undefined || asset.status === 'rejected') {
          return ctx.notFound('Image not found');
        }
        if (asset.id === owner.visualAssetId) return json(view());
        if (generating()) return ctx.refused(409, WAIT_MESSAGE);
        if (asset.status !== 'pending') {
          return ctx.refused(409, 'Only a finished image can be used');
        }
        if (pending().length > 1) return ctx.refused(409, COMPARE_FIRST_MESSAGE);
        const replaced = owner.visualAssetId;
        list[index] = { ...asset, status: 'approved' };
        owner.visualAssetId = asset.id;
        reject([replaced, ...list.filter((a) => a.status === 'failed').map((a) => a.id)]);
        return json(view());
      }
      return null;
    },
  };
}
