/**
 * Chooses what the model is told about the campaign for one import (governance §10 step 2,
 * D-27): which records go in full, which as a one-line summary, and which only in the index.
 *
 * - **Full**: the records the GM's notes name, and the record a `fill` import completes.
 *   Only these can be updated, since an update replaces whole field values.
 * - **Summary**: every Faction and Area, and the records linked to a full one.
 * - **Index**: everything else. Every record is at least here, so the model knows it exists
 *   and doesn't propose it again.
 *
 * All inside a size budget, most relevant first: a record that doesn't fit in full drops to
 * a summary, and a summary that doesn't fit drops to the index.
 *
 * Pure: `campaigns/ai-imports.ts` reads the rows, this decides.
 */
import {
  AI_IMPORT_LIMITS,
  INVERSE_LINK_FIELDS,
  inverseLinkFieldsOf,
  isEmptyRichText,
  RECORD_TYPES,
  richTextToPlainText,
  type RecordType,
  type RichText,
} from '@stagehand/shared';

import {
  existingRef,
  fieldSpecsOf,
  type ContextPack,
  type ContextRecord,
  type ContextRecordFull,
} from './context';
import type { MentionRef } from './markdown';
import { recordDetailBlock, recordIndexLine } from './prompt';

/** A campaign record as the pack builder needs it. */
export interface PackSourceRecord {
  id: string;
  type: RecordType;
  name: string;
  parentId: string | null;
  tags: string[];
  publicDescription: RichText;
  gmNotes: RichText;
  fields: Record<string, unknown>;
}

/** A field or other link between two records of the campaign. */
export interface PackSourceLink {
  fromId: string;
  toId: string;
  /** The link field of the from-record, or null for a free-form link. */
  fieldKey: string | null;
  label: string | null;
}

export interface BuildPackInput {
  records: readonly PackSourceRecord[];
  links: readonly PackSourceLink[];
  /** The GM's notes: records they name are shown in full. */
  text: string;
  /** `fill` mode: the record to complete. */
  fillTargetId: string | null;
  /** Size budget for the campaign block, in characters. */
  maxChars?: number;
}

export interface BuiltPack {
  pack: ContextPack;
  /** How many records went in at each level. */
  levels: { index: number; summary: number; full: number };
}

const SUMMARY_MAX = 200;
/** Shortest word of a name that can identify its record by itself. */
const DISTINCTIVE_WORD_MIN = 4;
/** Words too common to identify a record, whatever names they appear in. */
const COMMON_WORDS = new Set([
  'about',
  'from',
  'into',
  'that',
  'their',
  'them',
  'they',
  'this',
  'with',
]);

/** The words of a text, lower-cased: runs of letters and digits. */
function wordsOf(text: string): string[] {
  return text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

/**
 * Which records a text names. `exact`: the whole name appears, word for word. `partial`: a
 * word of the name appears that no other record's name has (the "Voss" of "Captain Voss").
 */
export function namedRecords(
  text: string,
  records: readonly Pick<PackSourceRecord, 'id' | 'name'>[],
): { exact: Set<string>; partial: Set<string> } {
  const textWords = wordsOf(text);
  const haystack = ` ${textWords.join(' ')} `;
  const present = new Set(textWords);

  const names = records.map((record) => ({ id: record.id, words: wordsOf(record.name) }));
  const namesWithWord = new Map<string, number>();
  for (const { words } of names) {
    for (const word of new Set(words)) {
      namesWithWord.set(word, (namesWithWord.get(word) ?? 0) + 1);
    }
  }

  const exact = new Set<string>();
  const partial = new Set<string>();
  for (const { id, words } of names) {
    if (words.length === 0) continue;
    if (haystack.includes(` ${words.join(' ')} `)) {
      exact.add(id);
    } else if (
      words.some(
        (word) =>
          word.length >= DISTINCTIVE_WORD_MIN &&
          !COMMON_WORDS.has(word) &&
          namesWithWord.get(word) === 1 &&
          present.has(word),
      )
    ) {
      partial.add(id);
    }
  }
  return { exact, partial };
}

/** One line about a record: the start of the first text it has. Null when it has none. */
export function summaryOf(record: PackSourceRecord): string | null {
  const docs: unknown[] = [record.publicDescription];
  for (const [key, spec] of Object.entries(fieldSpecsOf(record.type))) {
    if (spec.kind === 'rich') docs.push(record.fields[key]);
  }
  docs.push(record.gmNotes);
  for (const doc of docs) {
    if (doc === undefined || doc === null || isEmptyRichText(doc as RichText)) continue;
    const text = richTextToPlainText(doc as RichText)
      .replace(/\s+/g, ' ')
      .trim();
    if (text === '') continue;
    return text.length <= SUMMARY_MAX ? text : `${text.slice(0, SUMMARY_MAX - 1).trimEnd()}…`;
  }
  return null;
}

/** True when `key` of a `type` record is the stored side of another type's inverse list. */
function storesInverse(type: RecordType, key: string): boolean {
  return Object.values(INVERSE_LINK_FIELDS).some((fields) =>
    Object.values(fields).some((inverse) => inverse.from === type && inverse.field === key),
  );
}

function fullOf(
  record: PackSourceRecord,
  links: readonly PackSourceLink[],
  typeOf: (id: string) => RecordType | undefined,
): ContextRecordFull {
  const fieldLinks: Record<string, string[]> = {};
  for (const [key, spec] of Object.entries(fieldSpecsOf(record.type))) {
    if (spec.kind === 'links') fieldLinks[key] = [];
  }
  const otherLinks: ContextRecordFull['otherLinks'] = [];
  for (const link of links) {
    if (link.fromId !== record.id) continue;
    if (link.fieldKey === null) otherLinks.push({ recordId: link.toId, label: link.label });
    else fieldLinks[link.fieldKey]?.push(link.toId);
  }
  const inverseLinks: Record<string, string[]> = {};
  for (const [key, inverse] of inverseLinkFieldsOf(record.type)) {
    inverseLinks[key] = links
      .filter(
        (link) =>
          link.toId === record.id &&
          link.fieldKey === inverse.field &&
          typeOf(link.fromId) === inverse.from,
      )
      .map((link) => link.fromId);
  }
  return {
    tags: record.tags,
    publicDescription: record.publicDescription,
    gmNotes: record.gmNotes,
    fields: record.fields,
    links: fieldLinks,
    otherLinks,
    ...(Object.keys(inverseLinks).length === 0 ? {} : { inverseLinks }),
  };
}

const typeOrder = new Map<RecordType, number>(RECORD_TYPES.map((type, index) => [type, index]));

export function buildContextPack(input: BuildPackInput): BuiltPack {
  const budget = input.maxChars ?? AI_IMPORT_LIMITS.contextMaxChars;
  // A fixed order, so the same campaign gets the same refs: by type, then by name.
  const sources = [...input.records].sort(
    (a, b) =>
      (typeOrder.get(a.type) ?? 0) - (typeOrder.get(b.type) ?? 0) ||
      a.name.toLowerCase().localeCompare(b.name.toLowerCase()) ||
      a.id.localeCompare(b.id),
  );
  const sourceById = new Map(sources.map((record) => [record.id, record]));
  const typeOf = (id: string) => sourceById.get(id)?.type;
  /** A Prop's Spot: the stored side of an inverse list (D-41). */
  const placeOf = new Map<string, string>();
  for (const link of input.links) {
    const type = typeOf(link.fromId);
    if (type !== undefined && link.fieldKey !== null && storesInverse(type, link.fieldKey)) {
      placeOf.set(link.fromId, link.toId);
    }
  }
  const records: ContextRecord[] = sources.map((record, index) => ({
    id: record.id,
    ref: existingRef(index),
    type: record.type,
    name: record.name,
    parentId: record.parentId,
    ...(placeOf.has(record.id) ? { placeId: placeOf.get(record.id) ?? null } : {}),
    summary: null,
    full: null,
  }));
  const byId = new Map(records.map((record) => [record.id, record]));
  const refOf: MentionRef = (id) => byId.get(id)?.ref ?? null;

  // The index always goes in whole: it is what stops duplicates.
  let room = budget - records.reduce((sum, r) => sum + recordIndexLine(r, refOf).length + 1, 0);

  /** Sets a record's level if its block fits (or `force`). False when it didn't fit. */
  const place = (id: string, level: 'full' | 'summary', force = false): boolean => {
    const record = byId.get(id);
    const source = sourceById.get(id);
    if (record === undefined || source === undefined) return false;
    if (record.full !== null || (level === 'summary' && record.summary !== null)) return true;

    const before = { summary: record.summary, full: record.full };
    if (level === 'full') record.full = fullOf(source, input.links, typeOf);
    else record.summary = summaryOf(source);
    if (record.full === null && record.summary === null) return true; // Nothing to say.

    const size = recordDetailBlock(record, refOf).length + 1;
    if (!force && size > room) {
      record.summary = before.summary;
      record.full = before.full;
      return false;
    }
    room -= size;
    return true;
  };

  // 1. Full: the fill target (always), then the records the notes name.
  const named = namedRecords(input.text, sources);
  const fullIds: string[] = [];
  const wantFull = [
    ...(input.fillTargetId === null ? [] : [input.fillTargetId]),
    ...sources.filter((record) => named.exact.has(record.id)).map((record) => record.id),
    ...sources.filter((record) => named.partial.has(record.id)).map((record) => record.id),
  ];
  const demoted: string[] = [];
  for (const id of new Set(wantFull)) {
    if (place(id, 'full', id === input.fillTargetId)) fullIds.push(id);
    else demoted.push(id);
  }

  // 2. Summaries: named records that didn't fit, every Faction and Area, then the
  //    neighbours of the full records.
  const isFull = new Set(fullIds);
  const neighbours: string[] = [];
  for (const id of fullIds) {
    const parentId = sourceById.get(id)?.parentId;
    if (parentId !== null && parentId !== undefined) neighbours.push(parentId);
  }
  for (const link of input.links) {
    if (isFull.has(link.fromId)) neighbours.push(link.toId);
    if (isFull.has(link.toId)) neighbours.push(link.fromId);
  }
  const wantSummary = [
    ...demoted,
    ...sources
      .filter((record) => record.type === 'faction' || record.type === 'area')
      .map((record) => record.id),
    ...neighbours,
  ];
  for (const id of new Set(wantSummary)) place(id, 'summary');

  const full = records.filter((record) => record.full !== null).length;
  const summary = records.filter((r) => r.full === null && r.summary !== null).length;
  return {
    pack: { records, fillTargetId: input.fillTargetId },
    levels: { index: records.length - full - summary, summary, full },
  };
}
