import type { AssetKind } from '@stagehand/shared';

/** Behind a cutout, so its transparency shows: a checkerboard in the theme's muted color. */
export const CHECKERBOARD = {
  background: 'repeating-conic-gradient(var(--muted) 0 25%, transparent 0 50%) 0 0 / 16px 16px',
};

export const KIND_LABELS: Record<AssetKind, string> = {
  character: 'Humanoid',
  monster: 'Monster',
  prop: 'Prop',
  backdrop: 'Backdrop',
};

/**
 * An image's alt text: "Harbour Bell, prop visual", then its place in a pair ("new") and
 * whether it is the model's original.
 */
export function visualAlt(
  name: string,
  kind: AssetKind,
  label: string | undefined,
  original: boolean,
): string {
  return [
    `${name}, ${KIND_LABELS[kind].toLowerCase()} visual`,
    ...(label === undefined ? [] : [label.toLowerCase()]),
    ...(original ? ['original'] : []),
  ].join(', ');
}
