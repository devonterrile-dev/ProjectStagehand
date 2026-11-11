/**
 * Moving between records from a record page (F1.5b). "Open" waits for the open record's
 * autosave to finish before leaving, so nothing typed is lost or saved out of order; a
 * failed save keeps the GM on the page, where the save status offers Retry. The provider
 * is `components/records/RecordNavigationProvider.tsx`.
 */
import { createContext, useContext } from 'react';

export type Settle = () => Promise<boolean>;

export interface RecordNavigation {
  /** The record's page, for `href`s and new tabs. */
  hrefOf: (recordId: string) => string;
  /** Waits for pending saves, then opens the record in this tab (unless a save failed). */
  open: (recordId: string) => Promise<void>;
  /** The open record's form registers its autosave here; returns the unregister. */
  register: (settle: Settle) => () => void;
}

export const RecordNavigationContext = createContext<RecordNavigation | null>(null);

/** The record page's navigation. Throws outside a `RecordNavigationProvider`. */
export function useRecordNavigation(): RecordNavigation {
  const navigation = useContext(RecordNavigationContext);
  if (navigation === null) throw new Error('useRecordNavigation needs a RecordNavigationProvider');
  return navigation;
}
