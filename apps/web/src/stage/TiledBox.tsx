import { useEffect, useMemo } from 'react';
import { BoxGeometry, type Texture } from 'three';

import { boxFaceUvScales } from './box-uvs';

const CORNERS_PER_FACE = 4;

export interface TiledBoxProps {
  size: [width: number, height: number, depth: number];
  position: [x: number, y: number, z: number];
  /** A repeating texture (`useTiledTexture`). */
  map: Texture;
  /** The world size one copy of the texture covers. */
  tile: number;
  /** A tint over the texture; white leaves it as drawn. */
  color?: string;
}

/**
 * A lit box whose texture is the same size on every face, however long or thin the box is
 * (`boxFaceUvScales`), so several boxes can share one texture and look like one material.
 */
export function TiledBox({ size, position, map, tile, color = '#ffffff' }: TiledBoxProps) {
  const [width, height, depth] = size;
  const geometry = useMemo(() => {
    const box = new BoxGeometry(width, height, depth);
    const uv = box.getAttribute('uv');
    boxFaceUvScales(width, height, depth, tile).forEach(([scaleU, scaleV], face) => {
      for (let corner = 0; corner < CORNERS_PER_FACE; corner += 1) {
        const index = face * CORNERS_PER_FACE + corner;
        uv.setXY(index, uv.getX(index) * scaleU, uv.getY(index) * scaleV);
      }
    });
    uv.needsUpdate = true;
    return box;
  }, [width, height, depth, tile]);
  useEffect(
    () => () => {
      geometry.dispose();
    },
    [geometry],
  );

  return (
    <mesh position={position} geometry={geometry}>
      <meshLambertMaterial map={map} color={color} />
    </mesh>
  );
}
