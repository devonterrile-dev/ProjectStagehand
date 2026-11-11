import {
  RECORD_TYPE_LABELS,
  recordTypeSchema,
  SEARCH_QUERY_MAX,
  TAGS_MAX,
  type RecordMatch,
  type RecordType,
} from '@stagehand/shared';

/** Where a search excerpt came from, as shown before it (F1.6b). */
export const MATCH_FIELD_LABELS: Record<RecordMatch['field'], string> = {
  publicDescription: 'Public description',
  gmNotes: 'GM notes',
};

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

/** The Records page's filters (F1.6b), kept in the URL: `?type=&q=&tag=&tag=&area=`. */
export interface RecordFilters {
  type: RecordType | null;
  /** Search text, trimmed; '' for none. */
  q: string;
  /** The record must have every one of these. */
  tags: string[];
  /** Only the Spots of this Area; only ever set while `type` is `spot`. */
  areaId: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Reads the filters from the URL, dropping anything the API would refuse. */
export function parseRecordFilters(params: URLSearchParams): RecordFilters {
  const type = parseTypeParam(params.get('type'));
  const tags = [
    ...new Set(
      params
        .getAll('tag')
        .map((tag) => tag.trim())
        .filter((tag) => tag !== ''),
    ),
  ].slice(0, TAGS_MAX);
  const area = params.get('area');
  return {
    type,
    q: (params.get('q') ?? '').trim().slice(0, SEARCH_QUERY_MAX),
    tags,
    areaId: type === 'spot' && area !== null && UUID.test(area) ? area : null,
  };
}

/** The URL search params for these filters (empty ones left out). */
export function filtersToParams(filters: RecordFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.type !== null) params.set('type', filters.type);
  if (filters.q !== '') params.set('q', filters.q);
  for (const tag of filters.tags) params.append('tag', tag);
  if (filters.type === 'spot' && filters.areaId !== null) params.set('area', filters.areaId);
  return params;
}

/** True when a search, tag or Area narrows the list (the type alone doesn't count). */
export function hasSearchFilters(filters: RecordFilters): boolean {
  return filters.q !== '' || filters.tags.length > 0 || filters.areaId !== null;
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

/** The list a picker, the @-mention menu or quick jump filters. */
interface FilterOptions {
  /** Only records of these types (items without a type, like stat blocks, are left out). */
  types?: readonly RecordType[];
  /** Leave these ids out (the record itself, records already linked). */
  exclude?: Iterable<string>;
  limit?: number;
}

/**
 * Items whose name contains `query`, ignoring case: names that start with it first, each
 * group in the list's (alphabetical) order. An empty query matches everything. Works on
 * records and on anything else with an id and a name (stat blocks, PCs).
 */
export function filterRecords<R extends { id: string; name: string; type?: RecordType }>(
  records: readonly R[],
  query: string,
  { types, exclude = [], limit = Infinity }: FilterOptions = {},
): R[] {
  const needle = query.trim().toLowerCase();
  const skip = new Set(exclude);
  const starts: R[] = [];
  const contains: R[] = [];
  for (const record of records) {
    if (skip.has(record.id)) continue;
    if (types !== undefined && (record.type === undefined || !types.includes(record.type))) {
      continue;
    }
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
