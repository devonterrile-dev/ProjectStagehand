/**
 * The context pack: what the model is told about the campaign for one import (governance
 * §10 step 2, D-27). It has no database in it, so the prompt builder, the validator and the
 * eval suite all work from the same plain value; `context-pack.ts` builds it from a campaign.
 *
 * Every existing record is in the pack, at one of three levels of detail:
 * - **index**: id, type and name only. Enough for the model to know the record exists (so it
 *   doesn't create it again) and to link to it.
 * - **summary**: plus one line about it.
 * - **full**: everything the record holds. Only these may be updated, because an update
 *   replaces a field's whole value and the model must have read what it replaces.
 *
 * Records are named to the model by a short ref (`E1`, `E2`…), never by their UUID.
 */
import {
  isEmptyRichText,
  RECORD_FIELD_SPECS,
  type FieldSpec,
  type RecordType,
  type RichText,
} from '@stagehand/shared';

/** Everything a record holds, as the validator and the prompt need it. */
export interface ContextRecordFull {
  tags: string[];
  publicDescription: RichText;
  gmNotes: RichText;
  /** The stored `fields` of the record's type. */
  fields: Record<string, unknown>;
  /** Link field → ids of the records it links. */
  links: Record<string, string[]>;
  otherLinks: { recordId: string; label: string | null }[];
  /**
   * Lists shown on this record but stored on others (D-41): a Spot's `propsHere` is the ids
   * of the Props whose `spot` link points at it. Keyed like `INVERSE_LINK_FIELDS`.
   */
  inverseLinks?: Record<string, string[]>;
}

export interface ContextRecord {
  /** The record's UUID. Never sent to the model. */
  id: string;
  /** What the model calls it: `E1`, `E2`… */
  ref: string;
  type: RecordType;
  name: string;
  /** A Spot's Area. */
  parentId: string | null;
  /** A Prop's Spot, from its `spot` link (D-41), so the index can say where it is. */
  placeId?: string | null;
  /** One line about the record, when the pack carries one. */
  summary: string | null;
  /** Present when the record is shown in full. */
  full: ContextRecordFull | null;
}

export interface ContextPack {
  records: ContextRecord[];
  /** `fill` mode: the record to complete. It is always shown in full. */
  fillTargetId: string | null;
}

/** The ref of the nth existing record (0-based). */
export function existingRef(index: number): string {
  return `E${String(index + 1)}`;
}

export function emptyContextPack(): ContextPack {
  return { records: [], fillTargetId: null };
}

/** Lookups over a pack. Refs are matched in upper case. */
export function indexPack(pack: ContextPack): {
  byRef: ReadonlyMap<string, ContextRecord>;
  byId: ReadonlyMap<string, ContextRecord>;
} {
  return {
    byRef: new Map(pack.records.map((record) => [record.ref.toUpperCase(), record])),
    byId: new Map(pack.records.map((record) => [record.id, record])),
  };
}

/** The field specs of a type, as a plain string-keyed map. */
export function fieldSpecsOf(type: RecordType): Record<string, FieldSpec> {
  return RECORD_FIELD_SPECS[type];
}

/** True when a stored value says nothing: missing, blank text, an empty document or list. */
export function isEmptyValue(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object' && (value as { type?: unknown }).type === 'doc') {
    return isEmptyRichText(value as RichText);
  }
  return false;
}

/**
 * The keys of a fully shown record that hold nothing yet, in display order: the common
 * fields, then the type's value fields, then its link fields. What `fill` mode may fill.
 */
export function emptyKeysOf(
  type: RecordType,
  full: ContextRecordFull,
): { fields: string[]; links: string[] } {
  const fields: string[] = [];
  const links: string[] = [];
  if (isEmptyRichText(full.publicDescription)) fields.push('publicDescription');
  for (const [key, spec] of Object.entries(fieldSpecsOf(type))) {
    if (spec.kind === 'links') {
      if ((full.links[key] ?? []).length === 0) links.push(key);
    } else if (isEmptyValue(full.fields[key])) {
      fields.push(key);
    }
  }
  if (isEmptyRichText(full.gmNotes)) fields.push('gmNotes');
  return { fields, links };
}
