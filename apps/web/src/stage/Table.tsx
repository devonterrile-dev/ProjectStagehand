import { STAGE_COLORS } from './colors';
import { FRAME, TABLE } from './dimensions';
import { STAGE_TEXTURES } from './textures';
import { TiledBox } from './TiledBox';
import { useTiledTexture } from './use-tiled-texture';

/**
 * The tabletop every player sits at (governance §12): wooden planks running left to right. It
 * runs from the theater's front toward the players; the sheet page and the inspect stage will
 * sit on it (F3.5). Suspends while its texture loads.
 */
export function Table() {
  const wood = useTiledTexture(STAGE_TEXTURES.wood.url);

  return (
    <TiledBox
      size={[TABLE.width, TABLE.thickness, TABLE.depth]}
      position={[0, TABLE.topY - TABLE.thickness / 2, FRAME.thickness + TABLE.depth / 2]}
      map={wood}
      tile={STAGE_TEXTURES.wood.tile}
      color={STAGE_COLORS.tableTop}
    />
  );
}
