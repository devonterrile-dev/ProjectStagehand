/** How sharply the stage is drawn (F3.1, governance §12 "Performance budget"). */

/**
 * The most device pixels per CSS pixel the stage draws at. Sharper than this costs integrated
 * graphics a lot for little gain. The stage test page can try other caps.
 */
export const MAX_PIXEL_RATIO = 1.5;

/** The caps the stage test page offers; "Native" is whatever the screen has. */
export const PIXEL_RATIO_CHOICES = [
  { label: '1x', value: 1 },
  { label: '1.5x', value: MAX_PIXEL_RATIO },
  { label: 'Native', value: 8 },
] as const;
