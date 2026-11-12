import type { ProposalRefs, RecordSummary } from '@stagehand/shared';
import { createContext, useContext } from 'react';

/** What every proposal card of one review needs. */
export interface Review {
  campaignId: string;
  importId: string;
  /** Every record a proposal points at, existing or proposed. */
  refs: ProposalRefs;
  /** The campaign's records as they are now: link targets that exist and @-mention choices. */
  records: readonly RecordSummary[];
  /** The campaign's records plus this import's proposed ones, for naming mentions. */
  byId: ReadonlyMap<string, RecordSummary>;
  /** Areas a proposed Spot may belong to: the campaign's and this import's. */
  areas: RecordSummary[];
  /** True once the import is saved or discarded, or the campaign is archived. */
  readOnly: boolean;
}

export const ReviewContext = createContext<Review | null>(null);

export function useReview(): Review {
  const review = useContext(ReviewContext);
  if (review === null) throw new Error('useReview needs a ReviewContext');
  return review;
}

/** A proposed record as a summary, so pickers and mentions can show it like a real one. */
export function proposedSummary(ref: { id: string; type: RecordSummary['type']; name: string }) {
  const summary: RecordSummary = {
    id: ref.id,
    type: ref.type,
    name: ref.name,
    tags: [],
    parentId: null,
    parentName: null,
    revealedAt: null,
    createdAt: '1970-01-01T00:00:00.000Z',
    updatedAt: '1970-01-01T00:00:00.000Z',
  };
  return summary;
}
