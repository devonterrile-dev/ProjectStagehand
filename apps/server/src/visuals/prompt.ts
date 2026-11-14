/**
 * The image prompt for a record or PC (F2.3, §11 step 1): the style bible's base style and the
 * asset kind's template, filled with the subject's name and a few labelled lines from its
 * fields. The lines and their order match the fixed test set (`eval/images/test-set.ts`), so
 * what `pnpm style:sample` tried is what the GM gets.
 */
import { richTextToPlainText, type AssetKind, type RichText } from '@stagehand/shared';
import {
  buildImagePrompt,
  subjectLines,
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
  | { subject: 'pc'; name: string; publicDescription: RichText; className: string };

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

/** The full text prompt sent to the image model. */
export function visualPrompt(bible: StyleBible, kind: AssetKind, source: VisualSource): string {
  const lines = subjectLinesFor(source).map(([label, value]) => [label, capped(value)] as const);
  return buildImagePrompt(bible, kind, { name: source.name, subject: subjectLines(lines) });
}
