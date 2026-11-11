import { RECORD_TYPE_LABELS, recordTypeSchema, type RecordType } from '@stagehand/shared';

/** The records list, optionally filtered to one type, or one record's page. */
export function recordsPath(campaignId: string, filter: RecordType | null = null): string {
  const base = `/campaigns/${campaignId}/records`;
  return filter === null ? base : `${base}?type=${filter}`;
}

export function recordPath(campaignId: string, recordId: string): string {
  return `/campaigns/${campaignId}/records/${recordId}`;
}

/** A PC's sheet page. */
export function characterPath(campaignId: string, characterId: string): string {
  return `/campaigns/${campaignId}/characters/${characterId}`;
}

export function statBlocksPath(campaignId: string): string {
  return `/campaigns/${campaignId}/stat-blocks`;
}

export function statBlockPath(campaignId: string, statBlockId: string): string {
  return `/campaigns/${campaignId}/stat-blocks/${statBlockId}`;
}

/** The `?type=` filter, or null for "all" (including unknown values). */
export function parseTypeParam(value: string | null): RecordType | null {
  const parsed = recordTypeSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** "alive" → "Alive", "story_beat" → "Story beat". */
export function enumLabel(option: string): string {
  return option.charAt(0).toUpperCase() + option.slice(1).replaceAll('_', ' ');
}

/** "NPCs", "Story beats", "Session notes": for headings and empty states. */
export function pluralLabel(type: RecordType): string {
  const label = RECORD_TYPE_LABELS[type];
  return type === 'session_notes' ? label : `${label}s`;
}

/** The record list a picker or the @-mention menu filters. */
interface FilterOptions {
  /** Only these types. */
  types?: readonly RecordType[];
  /** Leave these ids out (the record itself, records already linked). */
  exclude?: Iterable<string>;
  limit?: number;
}

/**
 * Records whose name contains `query`, ignoring case: names that start with it first, each
 * group in the list's (alphabetical) order. An empty query matches everything.
 */
export function filterRecords<R extends { id: string; type: RecordType; name: string }>(
  records: readonly R[],
  query: string,
  { types, exclude = [], limit = Infinity }: FilterOptions = {},
): R[] {
  const needle = query.trim().toLowerCase();
  const skip = new Set(exclude);
  const starts: R[] = [];
  const contains: R[] = [];
  for (const record of records) {
    if (skip.has(record.id) || (types !== undefined && !types.includes(record.type))) continue;
    const name = record.name.toLowerCase();
    if (name.startsWith(needle)) starts.push(record);
    else if (name.includes(needle)) contains.push(record);
  }
  return [...starts, ...contains].slice(0, limit);
}

/** The DOM id of option `index` of listbox `id`, for `aria-activedescendant`. */
export function optionId(id: string, index: number): string {
  return `${id}-option-${String(index)}`;
}
