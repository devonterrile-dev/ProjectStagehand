/**
 * Every mounted autosave (records, sheets, stat blocks), so something outside the page,
 * like quick jump (F1.6b), can wait for pending edits before leaving. `useAutosave`
 * registers itself while mounted. A record page's own "Open" (F1.5b) waits through
 * `lib/record-navigation.ts` instead.
 */

/** Sends what's pending and waits; false when a save failed. */
type Settle = () => Promise<boolean>;

const settles = new Set<Settle>();

/** Adds an autosave; returns the function that removes it again. */
export function registerPendingSave(settle: Settle): () => void {
  settles.add(settle);
  return () => {
    settles.delete(settle);
  };
}

/** Waits for every mounted autosave. False when any of them failed to save. */
export async function settlePendingSaves(): Promise<boolean> {
  const results = await Promise.all([...settles].map((settle) => settle()));
  return results.every(Boolean);
}
