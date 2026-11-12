import { emptyRichText, type RecordType } from '@stagehand/shared';
import { describe, expect, it } from 'vitest';

import { doc } from '../../test/import-fixtures';

import {
  buildContextPack,
  namedRecords,
  summaryOf,
  type PackSourceLink,
  type PackSourceRecord,
} from './context-pack';
import { buildCampaignBlock } from './prompt';

let nextId = 0;
function record(
  type: RecordType,
  name: string,
  overrides: Partial<PackSourceRecord> = {},
): PackSourceRecord {
  nextId += 1;
  return {
    id: `c0000000-0000-4000-8000-${String(nextId).padStart(12, '0')}`,
    type,
    name,
    parentId: null,
    tags: [],
    publicDescription: emptyRichText(),
    gmNotes: emptyRichText(),
    fields: {},
    ...overrides,
  };
}

function campaign() {
  const saltmarsh = record('area', 'Saltmarsh', {
    publicDescription: doc('A fishing port that lives off smuggling.'),
  });
  const rat = record('spot', 'The Drowned Rat', { parentId: saltmarsh.id });
  const voss = record('npc', 'Captain Voss', {
    tags: ['harbor'],
    gmNotes: doc('Takes coin from the Tidecallers.'),
    fields: { appearance: 'Grey coat.', secrets: doc('Owes the guild.') },
  });
  const mira = record('npc', 'Mira');
  const watch = record('faction', 'Harbor Watch', { fields: { goals: doc('Keep the peace.') } });
  const market = record('spot', 'Harbor Market', { parentId: saltmarsh.id });
  const key = record('item', 'Brass key');
  const links: PackSourceLink[] = [
    { fromId: voss.id, toId: watch.id, fieldKey: 'factions', label: null },
    { fromId: voss.id, toId: key.id, fieldKey: null, label: 'carries' },
    { fromId: rat.id, toId: mira.id, fieldKey: 'npcsHere', label: null },
  ];
  const records = [saltmarsh, rat, voss, mira, watch, market, key];
  return { records, links, saltmarsh, rat, voss, mira, watch, market, key };
}

describe('namedRecords', () => {
  const { records, voss, rat, watch, market, mira, key } = campaign();

  it('finds a whole name, whatever the case and punctuation', () => {
    const { exact } = namedRecords("We met at THE DROWNED RAT. Mira's there.", records);
    expect([...exact].sort()).toEqual([rat.id, mira.id].sort());
  });

  it('finds a record by a word only its name has', () => {
    const { exact, partial } = namedRecords('Voss wants the key back.', records);
    expect([...exact]).toEqual([]);
    // "key" is too short to count, so only Voss is found.
    expect([...partial]).toEqual([voss.id]);
    expect(partial.has(key.id)).toBe(false);
  });

  it("doesn't match on a word two names share", () => {
    // "Harbor" is in Harbor Watch and Harbor Market.
    const { exact, partial } = namedRecords('Down by the harbor.', records);
    expect(exact.size + partial.size).toBe(0);
    expect(namedRecords('The watch is late.', records).partial.has(watch.id)).toBe(true);
    expect(namedRecords('The watch is late.', records).partial.has(market.id)).toBe(false);
  });

  it("doesn't match inside a longer word", () => {
    expect(namedRecords('Admiral Vossberg arrived.', records).partial.size).toBe(0);
  });
});

describe('summaryOf', () => {
  it('uses the first text the record has, cut to one line', () => {
    expect(summaryOf(record('npc', 'A', { publicDescription: doc('Public.') }))).toBe('Public.');
    expect(summaryOf(record('faction', 'B', { fields: { goals: doc('Rule\nthe  docks.') } }))).toBe(
      'Rule the docks.',
    );
    expect(summaryOf(record('npc', 'C', { gmNotes: doc('Private.') }))).toBe('Private.');
    expect(summaryOf(record('npc', 'D'))).toBeNull();

    const long = summaryOf(record('npc', 'E', { gmNotes: doc('word '.repeat(100)) }));
    expect(long?.length).toBeLessThanOrEqual(200);
    expect(long?.endsWith('…')).toBe(true);
  });
});

describe('buildContextPack', () => {
  it('puts every record in the index, ordered by type then name', () => {
    const { records, links } = campaign();
    const { pack, levels } = buildContextPack({ records, links, text: '', fillTargetId: null });

    expect(pack.records.map((r) => `${r.ref} ${r.type} ${r.name}`)).toEqual([
      'E1 npc Captain Voss',
      'E2 npc Mira',
      'E3 area Saltmarsh',
      'E4 spot Harbor Market',
      'E5 spot The Drowned Rat',
      'E6 faction Harbor Watch',
      'E7 item Brass key',
    ]);
    // With no notes, only the factions and areas get a line.
    expect(pack.records.filter((r) => r.summary !== null).map((r) => r.name)).toEqual([
      'Saltmarsh',
      'Harbor Watch',
    ]);
    expect(levels).toEqual({ index: 5, summary: 2, full: 0 });
    expect(pack.fillTargetId).toBeNull();
  });

  it('shows named records in full, with their links, and summarises their neighbours', () => {
    const { records, links, voss, watch, key } = campaign();
    const { pack, levels } = buildContextPack({
      records,
      links,
      text: 'Captain Voss has gone missing.',
      fillTargetId: null,
    });

    const byName = new Map(pack.records.map((r) => [r.name, r]));
    expect(byName.get('Captain Voss')?.full).toEqual({
      tags: ['harbor'],
      publicDescription: voss.publicDescription,
      gmNotes: voss.gmNotes,
      fields: voss.fields,
      links: { homeSpot: [], factions: [watch.id] },
      otherLinks: [{ recordId: key.id, label: 'carries' }],
    });
    expect(byName.get('Harbor Watch')?.summary).toBe('Keep the peace.');
    // The key is a neighbour but has no text, so it stays in the index.
    expect(byName.get('Brass key')).toMatchObject({ summary: null, full: null });
    expect(byName.get('Saltmarsh')?.summary).toBe('A fishing port that lives off smuggling.');
    expect(byName.get('Mira')).toMatchObject({ summary: null, full: null });
    expect(levels).toEqual({ index: 4, summary: 2, full: 1 });
  });

  it('always shows the fill target in full', () => {
    const { records, links, mira } = campaign();
    const { pack } = buildContextPack({ records, links, text: '', fillTargetId: mira.id });

    expect(pack.fillTargetId).toBe(mira.id);
    expect(pack.records.find((r) => r.id === mira.id)?.full).not.toBeNull();
  });

  it('stays inside the budget: full drops to a summary, then to the index', () => {
    const big = (name: string) => record('npc', name, { gmNotes: doc(`${name} `.repeat(300)) });
    const records = [big('Alder'), big('Birch'), big('Cedar'), record('area', 'Grove')];
    const text = 'Alder, Birch and Cedar met in the Grove.';

    const roomy = buildContextPack({ records, links: [], text, fillTargetId: null });
    expect(roomy.levels.full).toBe(4);

    const tight = buildContextPack({
      records,
      links: [],
      text,
      fillTargetId: null,
      maxChars: 4500,
    });
    // Two of the long records fit; the third drops to a line. The Grove is small and fits.
    expect(tight.levels).toEqual({ index: 0, summary: 1, full: 3 });
    expect(tight.pack.records.find((r) => r.name === 'Cedar')).toMatchObject({
      full: null,
      summary: expect.stringMatching(/^Cedar Cedar/) as string,
    });
    expect(buildCampaignBlock(tight.pack).length).toBeLessThanOrEqual(4500);

    const tiny = buildContextPack({ records, links: [], text, fillTargetId: null, maxChars: 200 });
    // None of the long records fits any more, not even as a line.
    expect(tiny.pack.records.filter((r) => r.type === 'npc')).toMatchObject([
      { full: null, summary: null },
      { full: null, summary: null },
      { full: null, summary: null },
    ]);
    // Every record is still in the index.
    expect(tiny.pack.records).toHaveLength(4);

    // The fill target goes in full even when it alone breaks the budget.
    const forced = buildContextPack({
      records,
      links: [],
      text: '',
      fillTargetId: records[0]?.id ?? null,
      maxChars: 200,
    });
    expect(forced.pack.records.find((r) => r.name === 'Alder')?.full).not.toBeNull();
  });
});
