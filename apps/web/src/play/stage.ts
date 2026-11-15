/**
 * The live stage as the theater draws it (F3.3). Everyone gets the players' view of the
 * theater, the GM too (governance §12 "Views and camera"): what the GM also knows about, hidden
 * props and puppets waiting below, is listed on the desk, not drawn. Pure.
 */
import type { LiveStage } from '@stagehand/shared';

import { stageImageUrl, type StageCutout } from '@/lib/scenes';

export function playPath(campaignId: string): string {
  return `/campaigns/${campaignId}/play`;
}

export interface TheaterView {
  backdropUrl: string | null;
  /** In list order: later ones are in front on the same depth tick. */
  cutouts: StageCutout[];
}

export const EMPTY_THEATER: TheaterView = { backdropUrl: null, cutouts: [] };

/** What is in sight on a stage: for a player all of it, for the GM what is shown and drawn. */
export function theaterView(campaignId: string, stage: LiveStage): TheaterView {
  const cutouts: StageCutout[] = [];
  for (const object of stage.objects) {
    if (object.image === null || ('shown' in object && !object.shown)) continue;
    cutouts.push({
      id: object.id,
      url: stageImageUrl(campaignId, object.image),
      width: object.image.width,
      height: object.image.height,
      across: object.across,
      up: object.up,
      depthTick: object.depthTick,
      scale: object.scale,
      flipped: object.flipped,
      mount: object.kind === 'prop' ? (object.mount ?? 'stand') : 'stick',
      faded: false,
      lowered: false,
    });
  }
  return {
    backdropUrl: stage.backdrop === null ? null : stageImageUrl(campaignId, stage.backdrop),
    cutouts,
  };
}

/** Every image a stage needs before the curtain opens on it. */
export function stageImageUrls(campaignId: string, stage: LiveStage): string[] {
  const view = theaterView(campaignId, stage);
  const urls = view.cutouts.map((cutout) => cutout.url);
  if (view.backdropUrl !== null) urls.push(view.backdropUrl);
  return [...new Set(urls)];
}
