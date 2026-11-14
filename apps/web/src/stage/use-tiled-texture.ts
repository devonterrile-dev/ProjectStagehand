import { useTexture } from '@react-three/drei';
import { RepeatWrapping, SRGBColorSpace, type Texture } from 'three';

/**
 * A texture that repeats in both directions, for `TiledBox`. Suspends while the image loads.
 * The table is seen at a shallow angle, so it is filtered to stay sharp there.
 */
export function useTiledTexture(url: string): Texture {
  return useTexture(url, (loaded) => {
    loaded.wrapS = RepeatWrapping;
    loaded.wrapT = RepeatWrapping;
    loaded.colorSpace = SRGBColorSpace;
    loaded.anisotropy = 8;
  });
}
