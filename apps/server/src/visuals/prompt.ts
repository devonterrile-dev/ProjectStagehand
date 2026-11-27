/**
 * The image prompt for a record or PC (F2.3, §11 step 1): the style bible's base style and the
 * asset kind's template, filled with the subject's name and a few labelled lines from its
 * fields. The lines and their order match the fixed test set (`eval/images/test-set.ts`), so
 * what `pnpm style:sample` tried is what the GM gets.
 *
 * A Regenerate with notes (F2.5) adds the style bible's revision block after that prompt.
 *
 * A transition Spot's backdrop is drawn from the style bible's transition template instead of
 * the backdrop's own, for Generate and Regenerate with notes alike (F5.3, D-74).
 */
import { richTextToPlainText, spotTypeOf, type AssetKind, type RichText } from '@stagehand/shared';
import {
  buildImagePrompt,
  buildRevisionPrompt,
  subjectLines,
  type ImagePromptInput,
  type StyleBible,
  type SubjectLine,
} from '@stagehand/style-bible';

/** Longest value one subject line carries; the record fields allow far more than a prompt needs. */
export const SUBJECT_LINE_MAX = 1000;

/** What a prompt is made from: a record's columns, or a PC's. */
export type VisualSource =
  | {
      subject: 'npc' | 'prop' | 'item' | 'spot';
      name: string;
      publicDescription: RichText;
      fields: Record<string, unknown>;
      /** A Spot's Area, for its `Area` line. */
      area?: { name: string; publicDescription: RichText } | null;
    }
  | {
      subject: 'pc';
      name: string;
      publicDescription: RichText;
      /** The linked class's name, else the typed one (F4.7). */
      className: string;
      /** "Faerie", or "Faerie and Orc" for a mixed ancestry; empty when none is linked (F4.8). */
      species?: string;
    };

function plain(doc: RichText): string {
  return richTextToPlainText(doc);
}

function text(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function capped(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const flat = value.replace(/\s+/g, ' ').trim();
  return flat.length <= SUBJECT_LINE_MAX
    ? flat
    : `${flat.slice(0, SUBJECT_LINE_MAX - 1).trimEnd()}…`;
}

/** The labelled lines for the template's `{{subject}}` slot, empty ones included (they drop out). */
export function subjectLinesFor(source: VisualSource): SubjectLine[] {
  const description = plain(source.publicDescription);
  switch (source.subject) {
    case 'pc':
      return [
        ['Class or role', source.className],
        ['Species', source.species ?? ''],
        ['Description', description],
      ];
    case 'npc':
    case 'prop':
      return [
        ['Appearance', text(source.fields['appearance'])],
        ['Description', description],
      ];
    case 'item':
      return [
        ['Kind', text(source.fields['kind'])],
        ['Appearance', text(source.fields['appearance'])],
        ['Description', description],
      ];
    case 'spot': {
      const area = source.area ?? null;
      const areaText = area === null ? null : plain(area.publicDescription).trim() || area.name;
      return [
        ['Backdrop notes', text(source.fields['backdropNotes'])],
        ['Area', areaText],
      ];
    }
  }
}

function promptInput(kind: AssetKind, source: VisualSource): ImagePromptInput {
  const lines = subjectLinesFor(source).map(([label, value]) => [label, capped(value)] as const);
  const input = { name: source.name, subject: subjectLines(lines) };
  const transition =
    kind === 'backdrop' && source.subject === 'spot' && spotTypeOf(source.fields) === 'transition';
  return transition ? { ...input, variant: 'transition' } : input;
}

/** The full text prompt sent to the image model. */
export function visualPrompt(bible: StyleBible, kind: AssetKind, source: VisualSource): string {
  return buildImagePrompt(bible, kind, promptInput(kind, source));
}

/**
 * The prompt for a Regenerate with notes (F2.5, D-44): the record's prompt as it reads now, then
 * the style bible's revision block with the GM's notes. Sent with the image being changed.
 */
export function revisionPrompt(
  bible: StyleBible,
  kind: AssetKind,
  source: VisualSource,
  notes: string,
): string {
  return buildRevisionPrompt(bible, kind, { ...promptInput(kind, source), notes });
}
