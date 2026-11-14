/**
 * The anchor images sent with each image request (F2.1b, D-39): only the asset kind's own
 * two. Read from disk once at startup, so a missing anchor stops the server instead of
 * failing a GM's first Generate visual.
 */
import { readFileSync } from 'node:fs';

import { ASSET_KINDS, type AssetKind } from '@stagehand/shared';
import {
  anchorMediaType,
  anchorsFor,
  StyleBibleError,
  type StyleBible,
} from '@stagehand/style-bible';

import type { ReferenceImage } from '../providers/openrouter';

export type ReferencesByKind = Record<AssetKind, readonly ReferenceImage[]>;

export function loadReferences(bible: StyleBible): ReferencesByKind {
  const byKind = {} as Record<AssetKind, ReferenceImage[]>;
  for (const kind of ASSET_KINDS) {
    byKind[kind] = anchorsFor(bible, kind).map((anchor) => {
      const mediaType = anchorMediaType(anchor.file);
      if (mediaType === null) throw new StyleBibleError(`Anchor has no image type: ${anchor.path}`);
      return { data: readFileSync(anchor.path), mediaType };
    });
  }
  return byKind;
}
