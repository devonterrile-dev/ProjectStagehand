/**
 * What the GM opened lately in a campaign, for quick jump (F1.6b). Kept in this browser's
 * localStorage as kinds and ids only, never names or text, newest first. Storage can be
 * missing or blocked (private windows, blocked site data); then there are just no recents.
 */
import { useEffect } from 'react';

export type RecentKind = 'record' | 'statBlock' | 'character';

export interface RecentItem {
  kind: RecentKind;
  id: string;
}

/** How many are kept; quick jump shows fewer, after dropping deleted ones. */
export const RECENT_STORED = 10;

const KINDS = new Set<string>(['record', 'statBlock', 'character']);

const storageKey = (campaignId: string) => `stagehand:recent:${campaignId}`;

function isRecentItem(value: unknown): value is RecentItem {
  if (typeof value !== 'object' || value === null) return false;
  const { kind, id } = value as Record<string, unknown>;
  return typeof kind === 'string' && KINDS.has(kind) && typeof id === 'string' && id !== '';
}

/** The campaign's recent items, newest first; empty when storage is unavailable or garbled. */
export function readRecent(campaignId: string): RecentItem[] {
  try {
    const raw = window.localStorage.getItem(storageKey(campaignId));
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isRecentItem).slice(0, RECENT_STORED) : [];
  } catch {
    return [];
  }
}

/** Puts the item first, once. Does nothing when storage is unavailable. */
export function rememberRecent(campaignId: string, item: RecentItem): void {
  const rest = readRecent(campaignId).filter(
    (other) => other.kind !== item.kind || other.id !== item.id,
  );
  try {
    window.localStorage.setItem(
      storageKey(campaignId),
      JSON.stringify([{ kind: item.kind, id: item.id }, ...rest].slice(0, RECENT_STORED)),
    );
  } catch {
    // Storage is blocked or full: recents are a convenience, so go without.
  }
}

/** Remembers the item once it has loaded (pass null until then). */
export function useRememberRecent(campaignId: string, item: RecentItem | null): void {
  const kind = item?.kind;
  const id = item?.id;
  useEffect(() => {
    if (kind !== undefined && id !== undefined) rememberRecent(campaignId, { kind, id });
  }, [campaignId, kind, id]);
}
