/**
 * The live stage as the theater draws it (F3.3, F3.4). Players see what is in sight. The GM sees
 * the same theater (governance §12 "Views and camera"), and, unless they ask to see it as
 * players do, the hidden props too, drawn see-through so they can be picked and shown. Puppets
 * waiting below are never drawn: they are listed on the desk. Pure.
 *
 * In a transition scene (F5.4) a passer carries where along the travel it began, and a puppet
 * that travels with the party walks. Hidden props are not drawn there even for the GM: they
 * come in from behind the right wall once shown, so they have no place of their own to show.
 */
import type {
  BattleSide,
  BattleSize,
  LiveStage,
  ObjectChanges,
  Presence,
  Square,
  Stroke,
} from '@stagehand/shared';

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
  const travels = stage.travel !== null;
  for (const stageObject of stage.objects) {
    const object = { ...stageObject, ...pending[stageObject.id] };
    if (object.image === null) continue;
    const isProp = object.kind === 'prop';
    const shown = !('shown' in object) || object.shown;
    if (!shown && !(isProp && hiddenProps && !travels)) continue;
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
      passFrom: object.passFrom,
      walking: travels && !isProp && object.passFrom === null,
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
 * The puppets talking right now (F3.7), by object id: each PC puppet whose player is speaking,
 * and the NPC puppet the GM voices while the GM speaks (F3.8). The GM's own voice moves nothing.
 */
export function talkingPuppets(cutouts: readonly StageCutout[], presence: Presence): Set<string> {
  const speaking = presence.filter((person) => person.speaking);
  const characters = new Set(speaking.flatMap((person) => person.characterId ?? []));
  const voiced = new Set(speaking.flatMap((person) => person.voicing ?? []));
  const talking = new Set<string>();
  for (const cutout of cutouts) {
    const pc = cutout.characterId != null && characters.has(cutout.characterId);
    if (pc || voiced.has(cutout.id)) talking.add(cutout.id);
  }
  return talking;
}

/** Every image a stage needs before the curtain opens on it, hidden props too for the GM. */
export function stageImageUrls(campaignId: string, stage: LiveStage): string[] {
  const view = theaterView(campaignId, stage, { hiddenProps: true });
  const urls = view.cutouts.map((cutout) => cutout.url);
  if (view.backdropUrl !== null) urls.push(view.backdropUrl);
  // The battle's tokens (F5.5), whose puppets may be waiting below.
  for (const token of battleView(campaignId, stage)?.tokens ?? []) urls.push(token.url);
  return [...new Set(urls)];
}

/** A battle token as the table draws it (F5.5). */
export interface BattleTokenView {
  /** The live object (a puppet) it stands for. */
  id: string;
  side: BattleSide;
  url: string;
  width: number;
  height: number;
  /** The GM's only: what the desk calls it. Null for a player. */
  name: string | null;
  /** On a square, or null while it waits beside the mat (the GM's only). */
  square: Square | null;
}

/** The battle on the table, as drawn (F5.5). */
export interface BattleView {
  size: BattleSize;
  tokens: BattleTokenView[];
  /** The paint on the mat (F5.6), in drawing order. */
  strokes: Stroke[];
}

/**
 * What the table draws of a stage's battle, or null when there is none. The GM's tokens take
 * their picture and name from their objects, and any move still on its way (`pending`) is drawn
 * where it is going; a token whose object has no picture is left out. A player's come with
 * their own pictures, and are all on the mat.
 */
export function battleView(
  campaignId: string,
  stage: LiveStage,
  pending: Readonly<Record<string, Square | null>> = {},
): BattleView | null {
  if (stage.battle === null) return null;
  if (stage.role === 'player') {
    return {
      size: stage.battle.size,
      strokes: stage.battle.strokes,
      tokens: stage.battle.tokens.map((token) => ({
        id: token.id,
        side: token.side,
        url: stageImageUrl(campaignId, token.image),
        width: token.image.width,
        height: token.image.height,
        name: null,
        square: token.square,
      })),
    };
  }
  const objects = new Map(stage.objects.map((object) => [object.id, object]));
  return {
    size: stage.battle.size,
    strokes: stage.battle.strokes,
    tokens: stage.battle.tokens.flatMap((token): BattleTokenView[] => {
      const object = objects.get(token.id);
      if (object?.image == null) return [];
      return [
        {
          id: token.id,
          side: token.side,
          url: stageImageUrl(campaignId, object.image),
          width: object.image.width,
          height: object.image.height,
          name: object.subject.name,
          square: token.id in pending ? (pending[token.id] ?? null) : token.square,
        },
      ];
    }),
  };
}
