/**
 * Helpers for the AI import pages (F1.8b): paths, labels, how proposals are grouped on the
 * review screen, and how token counts and costs are written.
 */
import {
  isEmptyRichText,
  linkFieldSpec,
  RECORD_FIELD_SPECS,
  RECORD_TYPES,
  type FieldSpec,
  type ImportMode,
  type ImportProposal,
  type ImportStatus,
  type ImportSummary,
  type ProposalReviewState,
  type RecordType,
  type RichText,
  type TokenUsage,
  type ValueFieldSpec,
} from '@stagehand/shared';

/** What the import page can be opened with. */
export interface ImportPageParams {
  mode?: ImportMode;
  /** `fill` mode: the record to fill in. */
  record?: string;
  /** "Try again": the import whose notes and settings fill the form. */
  from?: string;
}

/** The new-import page, optionally preset. */
export function importPath(campaignId: string, params: ImportPageParams = {}): string {
  const search = new URLSearchParams();
  if (params.mode !== undefined) search.set('mode', params.mode);
  if (params.record !== undefined) search.set('record', params.record);
  if (params.from !== undefined) search.set('from', params.from);
  const query = search.toString();
  return `/campaigns/${campaignId}/import${query === '' ? '' : `?${query}`}`;
}

/** One import's progress and review page. */
export function importReviewPath(campaignId: string, importId: string): string {
  return `/campaigns/${campaignId}/imports/${importId}`;
}

export const IMPORT_MODE_LABELS: Record<ImportMode, string> = {
  bootstrap: 'Start a campaign',
  add: 'Add to campaign',
  fill: 'Fill in a record',
};

export const IMPORT_STATUS_LABELS: Record<ImportStatus, string> = {
  running: 'Running',
  questions: 'Has questions',
  ready: 'Ready to review',
  failed: 'Failed',
  committed: 'Saved',
  discarded: 'Discarded',
};

export const REVIEW_STATE_LABELS: Record<ProposalReviewState, string> = {
  pending: 'Pending',
  accepted: 'Accepted',
  edited: 'Edited',
  rejected: 'Rejected',
};

/** Edited proposals were accepted after the GM changed them. */
export const isAccepted = (state: ProposalReviewState) =>
  state === 'accepted' || state === 'edited';

export type CreateProposal = Extract<ImportProposal, { action: 'create' }>;
export type UpdateProposal = Extract<ImportProposal, { action: 'update' }>;
export type LinkProposal = Extract<ImportProposal, { action: 'link' }>;

export interface ProposalGroups {
  creates: CreateProposal[];
  updates: UpdateProposal[];
  links: LinkProposal[];
}

/**
 * The review screen's sections: new records (Areas first, then Spots, then the other types
 * in their usual order), then changes to existing records, then links. Within a group,
 * proposals keep the model's order.
 */
export function groupProposals(proposals: readonly ImportProposal[]): ProposalGroups {
  const byPosition = [...proposals].sort((a, b) => a.position - b.position);
  const typeRank = (type: (typeof RECORD_TYPES)[number]) =>
    // Places first, then the Props at them (F1.10), then everything else in type order.
    type === 'area' ? -3 : type === 'spot' ? -2 : type === 'prop' ? -1 : RECORD_TYPES.indexOf(type);
  const creates = byPosition
    .filter((p): p is CreateProposal => p.action === 'create')
    .sort((a, b) => typeRank(a.payload.type) - typeRank(b.payload.type));
  return {
    creates,
    updates: byPosition.filter((p): p is UpdateProposal => p.action === 'update'),
    links: byPosition.filter((p): p is LinkProposal => p.action === 'link'),
  };
}

export interface ReviewCounts {
  accepted: number;
  rejected: number;
  pending: number;
}

export function reviewCounts(proposals: readonly { reviewState: ProposalReviewState }[]) {
  const counts: ReviewCounts = { accepted: 0, rejected: 0, pending: 0 };
  for (const { reviewState } of proposals) {
    if (isAccepted(reviewState)) counts.accepted += 1;
    else counts[reviewState] += 1;
  }
  return counts;
}

/** "3 proposals", "1 proposal". */
export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count.toLocaleString('en-US')} ${count === 1 ? one : many}`;
}

/** "$0.42", "< $0.01", or "—" when the model has no listed price. */
export function formatUsd(amount: number | null): string {
  if (amount === null) return '—';
  if (amount === 0) return '$0.00';
  if (amount < 0.01) return '< $0.01';
  return `$${amount.toFixed(2)}`;
}

/** Every token of a call, cache reads and writes included. */
export function totalTokens(usage: TokenUsage): number {
  return usage.inputTokens + usage.outputTokens + usage.cacheReadTokens + usage.cacheWriteTokens;
}

/** "12,345". */
export function formatTokens(count: number): string {
  return count.toLocaleString('en-US');
}

const dateTime = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export function formatWhen(iso: string): string {
  return dateTime.format(new Date(iso));
}

/** A type's fields in display order (§8). */
export const specsOf = (type: RecordType) =>
  Object.entries(RECORD_FIELD_SPECS[type] as Record<string, FieldSpec>);

/** The changed value fields of an update, in display order. */
export function changedFieldSpecs(proposal: UpdateProposal): [string, ValueFieldSpec][] {
  const fields = proposal.payload.fields ?? {};
  return specsOf(proposal.payload.type).filter(
    (entry): entry is [string, ValueFieldSpec] => entry[1].kind !== 'links' && entry[0] in fields,
  );
}

/** True for a value that shows as nothing: missing, blank, an empty list or document. */
export function isBlank(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object' && (value as { type?: unknown }).type === 'doc') {
    return isEmptyRichText(value as RichText);
  }
  return false;
}

/** What a link proposal fills: a link field's label, or the free-form relationship. */
export function linkKindLabel(payload: LinkProposal['payload']): string {
  if (payload.fieldKey !== null) {
    return linkFieldSpec(payload.fromType, payload.fieldKey)?.label ?? payload.fieldKey;
  }
  return payload.label ?? 'Linked to';
}

/** "3 new, 2 changes, 4 links". */
export function proposalCountsLabel(counts: ImportSummary['proposalCounts']): string {
  const parts = [
    counts.create > 0 ? `${String(counts.create)} new` : null,
    counts.update > 0 ? plural(counts.update, 'change') : null,
    counts.link > 0 ? plural(counts.link, 'link') : null,
  ].filter((part) => part !== null);
  return parts.length === 0 ? 'No proposals' : parts.join(', ');
}

/** `record` with `key` set to `value`, or without `key` when `value` is null or undefined. */
export function withKey<T extends object>(record: T, key: string, value: unknown): T {
  const rest = Object.fromEntries(Object.entries(record).filter(([other]) => other !== key));
  return (value === null || value === undefined ? rest : { ...rest, [key]: value }) as T;
}
