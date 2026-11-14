/**
 * The stage's generated textures (F3.1), made by `pnpm stage:textures`: wood planks for the
 * table, kraft cardboard for the outside of the theater, and the blurred room around them.
 */
import cardboard from './textures/cardboard.webp';
import room from './textures/room.webp';
import wood from './textures/wood.webp';

export const STAGE_TEXTURES = {
  /** Tiles both ways; its planks run across the picture. */
  wood: { url: wood, tile: 2 },
  /** Tiles both ways. */
  cardboard: { url: cardboard, tile: 1 },
  /** Equirectangular: wraps once around a sphere. */
  room: { url: room },
} as const;
