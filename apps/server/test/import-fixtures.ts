/**
 * A small campaign as the AI import sees it (a context pack), for the prompt, validator and
 * pipeline tests. No database: ids are fixed.
 */
import { emptyRichText, type ImportWireOutput, type RichText } from '@stagehand/shared';

import type { ContextPack, ContextRecord, ContextRecordFull } from '../src/ai-import/context';

export const IDS = {
  saltmarsh: 'a0000000-0000-4000-8000-000000000001',
  drownedRat: 'a0000000-0000-4000-8000-000000000002',
  voss: 'a0000000-0000-4000-8000-000000000003',
  harborWatch: 'a0000000-0000-4000-8000-000000000004',
  tidecallers: 'a0000000-0000-4000-8000-000000000005',
  brassKey: 'a0000000-0000-4000-8000-000000000006',
} as const;

export const doc = (text: string): RichText => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
});

export function full(overrides: Partial<ContextRecordFull> = {}): ContextRecordFull {
  return {
    tags: [],
    publicDescription: emptyRichText(),
    gmNotes: emptyRichText(),
    fields: {},
    links: {},
    otherLinks: [],
    ...overrides,
  };
}

/**
 * Saltmarsh (E1, area, summary), The Drowned Rat (E2, spot in E1, index only), Captain Voss
 * (E3, npc, full), the Harbor Watch (E4, faction, summary), the Tidecallers (E5, faction,
 * index only) and a brass key (E6, item, full).
 */
export function harborPack(): ContextPack {
  const records: ContextRecord[] = [
    {
      id: IDS.saltmarsh,
      ref: 'E1',
      type: 'area',
      name: 'Saltmarsh',
      parentId: null,
      summary: 'A fishing port that lives off smuggling.',
      full: null,
    },
    {
      id: IDS.drownedRat,
      ref: 'E2',
      type: 'spot',
      name: 'The Drowned Rat',
      parentId: IDS.saltmarsh,
      summary: null,
      full: null,
    },
    {
      id: IDS.voss,
      ref: 'E3',
      type: 'npc',
      name: 'Captain Voss',
      parentId: null,
      summary: null,
      full: full({
        tags: ['harbor'],
        publicDescription: doc('The weathered captain of the Harbor Watch.'),
        fields: {
          appearance: 'Grey coat, salt-white beard.',
          status: 'alive',
          secrets: {
            type: 'doc',
            content: [
              {
                type: 'paragraph',
                content: [
                  { type: 'text', text: 'Takes coin from the ' },
                  { type: 'mention', attrs: { id: IDS.tidecallers, label: 'Tidecallers' } },
                  { type: 'text', text: '.' },
                ],
              },
            ],
          },
        },
        links: { homeSpot: [], factions: [IDS.harborWatch] },
        otherLinks: [{ recordId: IDS.brassKey, label: 'carries' }],
      }),
    },
    {
      id: IDS.harborWatch,
      ref: 'E4',
      type: 'faction',
      name: 'Harbor Watch',
      parentId: null,
      summary: 'The town guard of Saltmarsh.',
      full: null,
    },
    {
      id: IDS.tidecallers,
      ref: 'E5',
      type: 'faction',
      name: 'Tidecallers',
      parentId: null,
      summary: null,
      full: null,
    },
    {
      id: IDS.brassKey,
      ref: 'E6',
      type: 'item',
      name: 'Brass key',
      parentId: null,
      summary: null,
      full: full({ fields: { kind: 'Key' }, links: { currentHolder: [IDS.voss] } }),
    },
  ];
  return { records, fillTargetId: null };
}

/** An answer with nothing in it, to build test answers on. */
export function wire(parts: Partial<ImportWireOutput> = {}): ImportWireOutput {
  return { creates: [], updates: [], links: [], questions: [], ...parts };
}

type WireCreate = ImportWireOutput['creates'][number];

export function wireCreate(
  create: Pick<WireCreate, 'id' | 'type' | 'name'> & Partial<WireCreate>,
): WireCreate {
  return { area: '', tags: [], fields: [], pointsOfInterest: [], ...create };
}

/** Ids for proposed records: b…0001, b…0002, … */
export function idMaker(): () => string {
  let next = 0;
  return () => {
    next += 1;
    return `b0000000-0000-4000-8000-${String(next).padStart(12, '0')}`;
  };
}

export const newId = (n: number) => `b0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
