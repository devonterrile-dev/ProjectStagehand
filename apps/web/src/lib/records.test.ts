import { describe, expect, it } from 'vitest';

import { filterRecords } from './records';

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
