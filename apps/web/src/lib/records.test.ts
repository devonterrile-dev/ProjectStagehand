import { describe, expect, it } from 'vitest';

import { filterRecords, filtersToParams, hasSearchFilters, parseRecordFilters } from './records';

const rec = (name: string, type: 'npc' | 'faction' = 'npc') => ({ id: name, type, name });
const names = (list: { name: string }[]) => list.map((r) => r.name);

describe('filterRecords', () => {
  const all = [
    rec('Ash Circle', 'faction'),
    rec('Brann'),
    rec('Mira'),
    rec('Tide Guild', 'faction'),
    rec('Vex the Miller'),
  ];

  it('lists names that start with the query first, then names containing it', () => {
    expect(names(filterRecords(all, 'mi'))).toEqual(['Mira', 'Vex the Miller']);
    expect(names(filterRecords(all, '  MI '))).toEqual(['Mira', 'Vex the Miller']);
  });

  it('keeps everything for an empty query, within the type, exclusion and limit', () => {
    expect(names(filterRecords(all, ''))).toEqual(names(all));
    expect(names(filterRecords(all, '', { types: ['faction'] }))).toEqual([
      'Ash Circle',
      'Tide Guild',
    ]);
    expect(names(filterRecords(all, '', { exclude: ['Brann', 'Mira'], limit: 2 }))).toEqual([
      'Ash Circle',
      'Tide Guild',
    ]);
  });
});

describe('filterRecords on items without a type', () => {
  const blocks = [
    { id: 'a', name: 'Vex Bruiser' },
    { id: 'b', name: 'Sea Hag' },
  ];

  it('filters stat blocks and PCs by name', () => {
    expect(names(filterRecords(blocks, 'vex'))).toEqual(['Vex Bruiser']);
  });

  it('leaves them out when only some record types are wanted', () => {
    expect(filterRecords(blocks, '', { types: ['npc'] })).toEqual([]);
  });
});

describe('record filters in the URL', () => {
  const AREA = '0b7e2f1c-3c1d-4b8a-9a50-6f2a0e1d9c11';
  const parse = (query: string) => parseRecordFilters(new URLSearchParams(query));

  it('reads every filter, trimmed, with duplicate and blank tags dropped', () => {
    expect(parse(`type=spot&q=+fish+&tag=a&tag=+b+&tag=a&tag=&area=${AREA}`)).toEqual({
      type: 'spot',
      q: 'fish',
      tags: ['a', 'b'],
      areaId: AREA,
    });
  });

  it('ignores an Area unless Spots are shown, and an id that is not one', () => {
    expect(parse(`area=${AREA}`).areaId).toBeNull();
    expect(parse(`type=npc&area=${AREA}`).areaId).toBeNull();
    expect(parse('type=spot&area=nope').areaId).toBeNull();
  });

  it('treats an unknown type as all, and nothing as no filters', () => {
    expect(parse('type=monster')).toEqual({ type: null, q: '', tags: [], areaId: null });
    expect(hasSearchFilters(parse('type=npc'))).toBe(false);
    expect(hasSearchFilters(parse('q=x'))).toBe(true);
    expect(hasSearchFilters(parse('tag=x'))).toBe(true);
  });

  it('writes them back, leaving empty ones out', () => {
    expect(
      filtersToParams({ type: 'spot', q: 'fish', tags: ['a', 'b c'], areaId: AREA }).toString(),
    ).toBe(`type=spot&q=fish&tag=a&tag=b+c&area=${AREA}`);
    expect(filtersToParams({ type: null, q: '', tags: [], areaId: null }).toString()).toBe('');
    expect(filtersToParams({ type: 'npc', q: '', tags: [], areaId: AREA }).toString()).toBe(
      'type=npc',
    );
  });
});
