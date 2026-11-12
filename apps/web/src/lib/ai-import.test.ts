import { describe, expect, it } from 'vitest';

import { record } from '@/test/app-harness';
import { createProposal, linkProposal, updateProposal } from '@/test/imports-world';

import {
  formatUsd,
  groupProposals,
  importPath,
  isBlank,
  proposalCountsLabel,
  reviewCounts,
  withKey,
} from './ai-import';

describe('importPath', () => {
  it('adds only the presets given', () => {
    expect(importPath('c1')).toBe('/campaigns/c1/import');
    expect(importPath('c1', { mode: 'fill', record: 'r1' })).toBe(
      '/campaigns/c1/import?mode=fill&record=r1',
    );
    expect(importPath('c1', { from: 'i1' })).toBe('/campaigns/c1/import?from=i1');
  });
});

describe('groupProposals', () => {
  it('puts Areas, then Spots, then other new records first, keeping the model order', () => {
    const vex = record({ type: 'npc', name: 'Captain Vex' });
    const proposals = [
      linkProposal(
        { fromId: vex.id, fromType: 'npc', toId: vex.id, fieldKey: null, label: null },
        { position: 0 },
      ),
      createProposal({ type: 'npc', name: 'B' }, { position: 1 }),
      createProposal({ type: 'spot', name: 'Den', parentId: vex.id }, { position: 2 }),
      updateProposal(vex, { name: 'Admiral Vex' }, { position: 3 }),
      createProposal({ type: 'faction', name: 'Fleet' }, { position: 4 }),
      createProposal({ type: 'area', name: 'Pier' }, { position: 5 }),
      createProposal({ type: 'npc', name: 'A' }, { position: 6 }),
    ];
    const groups = groupProposals(proposals);
    expect(groups.creates.map((p) => p.payload.name)).toEqual(['Pier', 'Den', 'B', 'A', 'Fleet']);
    expect(groups.updates.map((p) => p.position)).toEqual([3]);
    expect(groups.links.map((p) => p.position)).toEqual([0]);
  });
});

describe('reviewCounts', () => {
  it('counts edited proposals as accepted', () => {
    const states = ['pending', 'accepted', 'edited', 'rejected', 'pending'] as const;
    expect(reviewCounts(states.map((reviewState) => ({ reviewState })))).toEqual({
      accepted: 2,
      rejected: 1,
      pending: 2,
    });
  });
});

describe('formatting', () => {
  it('writes costs to the cent, tiny ones as under a cent, unknown ones as a dash', () => {
    expect(formatUsd(1.234)).toBe('$1.23');
    expect(formatUsd(0.004)).toBe('< $0.01');
    expect(formatUsd(0)).toBe('$0.00');
    expect(formatUsd(null)).toBe('—');
  });

  it('labels proposal counts', () => {
    expect(proposalCountsLabel({ create: 3, update: 1, link: 2 })).toBe('3 new, 1 change, 2 links');
    expect(proposalCountsLabel({ create: 0, update: 0, link: 0 })).toBe('No proposals');
  });
});

describe('isBlank and withKey', () => {
  it('treats missing, blank and empty values as blank', () => {
    expect(isBlank(undefined)).toBe(true);
    expect(isBlank('  ')).toBe(true);
    expect(isBlank([])).toBe(true);
    expect(isBlank({ type: 'doc', content: [{ type: 'paragraph' }] })).toBe(true);
    expect(isBlank('x')).toBe(false);
    expect(isBlank(0)).toBe(false);
  });

  it('sets a key, or removes it for null', () => {
    expect(withKey({ a: 1, b: 2 }, 'b', null)).toEqual({ a: 1 });
    expect(withKey({ a: 1 }, 'b', 3)).toEqual({ a: 1, b: 3 });
  });
});
