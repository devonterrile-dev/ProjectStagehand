/**
 * The scene builder's own rules (F3.2, governance §12 "Scene builder"): where a new object
 * goes, what may be added, what is sent to the server, and what the theater draws. Pure, so
 * the page and its tests share them.
 */
import {
  assetImagePath,
  DEPTH_TICKS,
  SCENE_MAX_OBJECTS,
  SCENE_SCALE,
  type SceneObject,
  type SceneObjectInput,
  type StageImage,
  type StageRecord,
} from '@stagehand/shared';

export function scenesPath(campaignId: string): string {
  return `/campaigns/${campaignId}/scenes`;
}

export function scenePath(campaignId: string, sceneId: string): string {
  return `/campaigns/${campaignId}/scenes/${sceneId}`;
}

/** "Fish Market (Saltmarsh)": a Spot with its Area, since two Areas can each have a market. */
export function spotLabel(spot: { name: string; parentName?: string | null }): string {
  return spot.parentName == null ? spot.name : `${spot.name} (${spot.parentName})`;
}

/** The URL of an image in use, as the stage draws it. */
export function stageImageUrl(campaignId: string, image: StageImage): string {
  return assetImagePath(campaignId, image.assetId, { processed: image });
}

/** New objects take these places across the opening in turn, so they don't pile up. */
const NEW_ACROSS = [0.5, 0.35, 0.65, 0.2, 0.8] as const;
/** A new object goes in the middle of the theater's depth. */
export const NEW_DEPTH_TICK = Math.floor(DEPTH_TICKS / 2);
/** A new puppet rises a little above the bottom edge; a new prop stands on it. */
const NEW_PUPPET_UP = 0.1;

/** Why a record can't be added to the scene right now, or null when it can. */
export function addRefusal(
  objects: readonly SceneObject[],
  entry: StageRecord,
): 'no-image' | 'full' | 'already-placed' | null {
  if (entry.image === null) return 'no-image';
  if (objects.length >= SCENE_MAX_OBJECTS) return 'full';
  if (entry.kind === 'puppet' && objects.some((object) => object.record.id === entry.record.id)) {
    return 'already-placed';
  }
  return null;
}

/** A record just placed: near the middle, at its own size, shown and on a stand or a stick. */
export function placeRecord(
  objects: readonly SceneObject[],
  entry: StageRecord,
  id: string,
): SceneObject {
  const isProp = entry.kind === 'prop';
  return {
    id,
    kind: entry.kind,
    record: entry.record,
    image: entry.image,
    across: NEW_ACROSS[objects.length % NEW_ACROSS.length] ?? 0.5,
    up: isProp ? 0 : NEW_PUPPET_UP,
    depthTick: NEW_DEPTH_TICK,
    scale: SCENE_SCALE.initial,
    flipped: false,
    shown: isProp,
    mount: isProp ? 'stand' : null,
    travelMode: isProp ? null : 'walking',
  };
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/**
 * A change to an object, kept inside what a scene allows: within the opening, on a real depth
 * tick, at a size the server accepts. A puppet never gains a mount or becomes shown.
 */
export function changeObject(object: SceneObject, change: Partial<SceneObject>): SceneObject {
  const next = { ...object, ...change };
  const isProp = object.kind === 'prop';
  return {
    ...next,
    id: object.id,
    kind: object.kind,
    record: object.record,
    across: clamp(next.across, 0, 1),
    up: clamp(next.up, 0, 1),
    depthTick: clamp(Math.round(next.depthTick), 0, DEPTH_TICKS - 1),
    scale: clamp(next.scale, SCENE_SCALE.min, SCENE_SCALE.max),
    shown: isProp ? next.shown : false,
    mount: isProp ? (next.mount ?? 'stand') : null,
    travelMode: isProp ? null : (next.travelMode ?? 'walking'),
  };
}

/**
 * An object as the server takes it: only a prop says whether it is shown and how it is held,
 * and only a puppet how it travels (F5.4).
 */
export function toObjectInput(object: SceneObject): SceneObjectInput {
  return {
    id: object.id,
    recordId: object.record.id,
    across: object.across,
    up: object.up,
    depthTick: object.depthTick,
    scale: object.scale,
    flipped: object.flipped,
    ...(object.kind === 'prop'
      ? { shown: object.shown, mount: object.mount ?? 'stand' }
      : { travelMode: object.travelMode ?? 'walking' }),
  };
}

/**
 * A transition scene's objects as the builder shows them (F5.4): every prop hidden, since it
 * passes by once shown; the server saves them so. Others as they are.
 */
export function asTransition(objects: readonly SceneObject[]): SceneObject[] {
  return objects.map((object) =>
    object.kind === 'prop' && object.shown ? { ...object, shown: false } : object,
  );
}

/** What a tray record carries while it is dragged into the theater: its record id (F3.2c). */
export const RECORD_DRAG_TYPE = 'application/x-stagehand-record';

/** How far an arrow key moves the selected object, as a share of the opening; Shift moves more. */
export const NUDGE = { step: 0.01, big: 0.05 } as const;

/** Where the keys move an object: across, up and between depth ticks. */
export type KeyPlacement = Pick<SceneObject, 'across' | 'up' | 'depthTick'>;

/** What a key does to the selected object. */
export type KeyAction = { change: Partial<KeyPlacement> } | 'remove' | 'deselect';

const tidy = (value: number) => Math.round(value * 10_000) / 10_000;

/**
 * The builder's keys (F3.2c): arrows nudge the selected object across and up, `[` steps it
 * forward and `]` back, Delete or Backspace removes it, Escape lets go of it. Null for any
 * other key.
 */
export function keyAction(object: KeyPlacement, key: string, shift: boolean): KeyAction | null {
  const step = shift ? NUDGE.big : NUDGE.step;
  switch (key) {
    case 'ArrowLeft':
      return { change: { across: tidy(object.across - step) } };
    case 'ArrowRight':
      return { change: { across: tidy(object.across + step) } };
    case 'ArrowUp':
      return { change: { up: tidy(object.up + step) } };
    case 'ArrowDown':
      return { change: { up: tidy(object.up - step) } };
    case '[':
      return { change: { depthTick: object.depthTick - 1 } };
    case ']':
      return { change: { depthTick: object.depthTick + 1 } };
    case 'Delete':
    case 'Backspace':
      return 'remove';
    case 'Escape':
      return 'deselect';
    default:
      return null;
  }
}

/** One cutout as the theater draws it: plain data, no Three.js. */
export interface StageCutout {
  id: string;
  url: string;
  /** The image's size in pixels. */
  width: number;
  height: number;
  across: number;
  up: number;
  depthTick: number;
  scale: number;
  flipped: boolean;
  mount: 'stick' | 'stand' | 'hang';
  /** A prop placed but hidden, as the builder shows it: see-through. */
  faded: boolean;
  /** A puppet waiting in the void, as players first see the scene: out of sight. */
  lowered: boolean;
  /**
   * Live play, a player's theater (F3.5b): the revealed record it shows, which pressing it
   * inspects. Absent or null: nothing to inspect.
   */
  recordId?: string | null;
  /** Live play (F3.7): the PC a puppet is, whose player emotes it and whose voice it shows. */
  characterId?: string | null;
  /**
   * Live play in a transition scene (F5.4): the travel distance it began to pass by at; its
   * place across follows the travel from then on. Absent or null: it stays where it is.
   */
  passFrom?: number | null;
  /** Live play in a transition scene (F5.4): a puppet that steps up and down while it plays. */
  walking?: boolean;
}

/**
 * What the theater draws for a scene's objects, in list order. While building, a hidden prop is
 * faded and a puppet stands where it will rise to. In `preview`, the scene is as players first
 * see it: hidden props are gone and puppets wait below. An object with no image is left out.
 */
export function stageCutouts(
  campaignId: string,
  objects: readonly SceneObject[],
  { preview }: { preview: boolean },
): StageCutout[] {
  return objects.flatMap((object) => {
    if (object.image === null) return [];
    const isProp = object.kind === 'prop';
    if (preview && isProp && !object.shown) return [];
    return [
      {
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
        faded: isProp && !object.shown,
        lowered: preview && !isProp,
      },
    ];
  });
}
