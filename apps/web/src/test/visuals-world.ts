/**
 * The Generate visual part of the fake API (F2.3): tries that start `generating`, finish on
 * the next poll (pending, or failed for a subject whose name contains `FAIL_VISUAL_WORD`), and
 * "Use this one", following the server's rules and messages (`apps/server/src/routes/visuals.ts`).
 */
import {
  generateVisualRequestSchema,
  isVisualSubject,
  useVisualRequestSchema,
  visualKindsFor,
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

export interface VisualsWorldOptions {
  /** Tries already made, by record or PC id, newest first. */
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
    processed: { ...PROCESSED_VISUAL },
    createdAt: '2026-11-13T09:00:00.000Z',
    finishedAt: '2026-11-13T09:01:00.000Z',
    ...overrides,
  };
}

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

  return {
    respond(
      found: Campaign,
      data: { records: CampaignRecord[]; characters: CharacterSheet[] },
      rest: string,
      method: string,
      rawBody: unknown,
    ): Response | null {
      const match = /^\/(records|characters)\/([^/]+)\/(visuals|visual)$/.exec(rest);
      if (match === null) return null;
      const [, table, ownerId = '', action] = match;
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
      const view = () => ({ visualAssetId: owner.visualAssetId, assets: list });

      if (action === 'visuals' && method === 'GET') {
        finish(owner, list);
        return json(view());
      }
      if (found.archivedAt !== null) return ctx.refused(409, 'Campaign is archived');

      if (action === 'visuals' && method === 'POST') {
        const parsed = generateVisualRequestSchema.safeParse(rawBody ?? {});
        if (!parsed.success) return ctx.refused(400, 'Invalid request');
        const kinds = visualKindsFor(subject);
        const kind = parsed.data.kind ?? (kinds.length === 1 ? kinds[0] : undefined);
        if (kind === undefined || !kinds.includes(kind)) {
          return ctx.refused(400, 'Choose whether this is a humanoid or a monster');
        }
        if (!ctx.hasKey()) return ctx.refused(409, NO_OPENROUTER_KEY_MESSAGE);
        if (list.some((asset) => asset.status === 'generating')) {
          return ctx.refused(
            409,
            'An image for this is already being made. Wait for it to finish.',
          );
        }
        const asset = assetSummary({
          kind,
          status: 'generating',
          costUsd: null,
          processed: null,
          createdAt: new Date().toISOString(),
          finishedAt: null,
        });
        list.unshift(asset);
        return json(asset, 202);
      }

      if (action === 'visual' && method === 'PUT') {
        const parsed = useVisualRequestSchema.safeParse(rawBody);
        if (!parsed.success) return ctx.refused(400, 'Invalid request');
        const index = list.findIndex((asset) => asset.id === parsed.data.assetId);
        const asset = list[index];
        if (asset === undefined) return ctx.notFound('Image not found');
        if (asset.status !== 'pending' && asset.status !== 'approved') {
          return ctx.refused(409, 'Only a finished image can be used');
        }
        list[index] = { ...asset, status: 'approved' };
        owner.visualAssetId = asset.id;
        return json(view());
      }
      return null;
    },
  };
}
