/**
 * The live stage as the theater draws it (F3.3, F3.4). Players see what is in sight. The GM sees
 * the same theater (governance §12 "Views and camera"), and, unless they ask to see it as
 * players do, the hidden props too, drawn see-through so they can be picked and shown. Puppets
 * waiting below are never drawn: they are listed on the desk. Pure.
 */
import type { LiveStage, ObjectChanges, Presence } from '@stagehand/shared';

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

export interface TheaterOptions {
  /** The GM's theater: hidden props drawn see-through. */
  hiddenProps?: boolean;
  /** The GM's moves still on their way to the server, drawn where they are going. */
  pending?: Readonly<Record<string, ObjectChanges>>;
}

/** What the theater draws of a stage. */
export function theaterView(
  campaignId: string,
  stage: LiveStage,
  { hiddenProps = false, pending = {} }: TheaterOptions = {},
): TheaterView {
  const cutouts: StageCutout[] = [];
  for (const stageObject of stage.objects) {
    const object = { ...stageObject, ...pending[stageObject.id] };
    if (object.image === null) continue;
    const isProp = object.kind === 'prop';
    const shown = !('shown' in object) || object.shown;
    if (!shown && !(isProp && hiddenProps)) continue;
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
      mount: isProp ? (object.mount ?? 'stand') : 'stick',
      faded: !shown,
      lowered: false,
      ...(stage.role === 'player' && 'recordId' in object ? { recordId: object.recordId } : {}),
      characterId:
        'subject' in object
          ? object.subject.kind === 'pc'
            ? object.subject.id
            : null
          : object.characterId,
    });
  }
  return {
    backdropUrl: stage.backdrop === null ? null : stageImageUrl(campaignId, stage.backdrop),
    cutouts,
  };
}

/**
 * The puppets talking right now (F3.7), by object id: each PC puppet whose player is speaking.
 * The GM's voice moves no puppet until NPC takeover (F3.8).
 */
export function talkingPuppets(cutouts: readonly StageCutout[], presence: Presence): Set<string> {
  const speaking = new Set(
    presence.flatMap((person) =>
      person.speaking && person.characterId !== null ? [person.characterId] : [],
    ),
  );
  const talking = new Set<string>();
  for (const cutout of cutouts) {
    if (cutout.characterId != null && speaking.has(cutout.characterId)) talking.add(cutout.id);
  }
  return talking;
}

/** Every image a stage needs before the curtain opens on it, hidden props too for the GM. */
export function stageImageUrls(campaignId: string, stage: LiveStage): string[] {
  const view = theaterView(campaignId, stage, { hiddenProps: true });
  const urls = view.cutouts.map((cutout) => cutout.url);
  if (view.backdropUrl !== null) urls.push(view.backdropUrl);
  return [...new Set(urls)];
}
