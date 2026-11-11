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
