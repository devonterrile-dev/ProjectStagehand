import { describe, expect, it } from 'vitest';

import {
  createRecordRequestSchema,
  recordListQuerySchema,
  recordNameSchema,
  recordSchema,
  recordSummarySchema,
  tagsSchema,
  updateRecordRequestSchema,
  updateRecordRequestSchemaFor,
} from './records';
import { emptyRichText } from './rich-text';

const AREA_ID = '0b7e2f1c-3c1d-4b8a-9a50-6f2a0e1d9c11';

describe('recordNameSchema', () => {
  it('trims, and allows 120 characters but not 121 or empty', () => {
    expect(recordNameSchema.parse('  Mira  ')).toBe('Mira');
    expect(recordNameSchema.safeParse('a'.repeat(120)).success).toBe(true);
    expect(recordNameSchema.safeParse('a'.repeat(121)).success).toBe(false);
    expect(recordNameSchema.safeParse('   ').success).toBe(false);
  });
});

describe('tagsSchema', () => {
  it('trims tags and refuses empties, duplicates and more than 20', () => {
    expect(tagsSchema.parse([' harbour ', 'guild'])).toEqual(['harbour', 'guild']);
    expect(tagsSchema.safeParse(['']).success).toBe(false);
    expect(tagsSchema.safeParse(['a', 'a ']).success).toBe(false);
    expect(
      tagsSchema.safeParse(Array.from({ length: 21 }, (_, i) => `t${String(i)}`)).success,
    ).toBe(false);
  });
});

describe('createRecordRequestSchema', () => {
  it('accepts a bare record of each type except spot without a parent', () => {
    expect(createRecordRequestSchema.parse({ type: 'npc', name: ' Mira ' })).toEqual({
      type: 'npc',
      name: 'Mira',
    });
    expect(
      createRecordRequestSchema.parse({ type: 'area', name: 'Saltmarsh', parentId: null }),
    ).toEqual({
      type: 'area',
      name: 'Saltmarsh',
      parentId: null,
    });
  });

  it('requires an area for a spot and refuses one on every other type', () => {
    expect(createRecordRequestSchema.safeParse({ type: 'spot', name: 'Market' }).success).toBe(
      false,
    );
    expect(
      createRecordRequestSchema.safeParse({ type: 'spot', name: 'Market', parentId: AREA_ID })
        .success,
    ).toBe(true);
    expect(
      createRecordRequestSchema.safeParse({ type: 'npc', name: 'Mira', parentId: AREA_ID }).success,
    ).toBe(false);
  });

  it("validates fields against the record's own type", () => {
    expect(
      createRecordRequestSchema.safeParse({
        type: 'npc',
        name: 'Mira',
        fields: { status: 'alive' },
      }).success,
    ).toBe(true);
    const wrongType = createRecordRequestSchema.safeParse({
      type: 'npc',
      name: 'Mira',
      fields: { goals: emptyRichText() },
    });
    expect(wrongType.success).toBe(false);
    expect(wrongType.error?.issues[0]).toMatchObject({ path: ['fields'], keys: ['goals'] });
  });

  it('rejects an unknown type and unknown top-level keys', () => {
    expect(createRecordRequestSchema.safeParse({ type: 'monster', name: 'Grue' }).success).toBe(
      false,
    );
    expect(
      createRecordRequestSchema.safeParse({ type: 'npc', name: 'Mira', revealedAt: null }).success,
    ).toBe(false);
  });
});

describe('update request schemas', () => {
  it('needs at least one key and only known ones', () => {
    expect(updateRecordRequestSchema.safeParse({}).success).toBe(false);
    expect(updateRecordRequestSchema.safeParse({ type: 'area' }).success).toBe(false);
    expect(updateRecordRequestSchema.parse({ name: ' Mira ' })).toEqual({ name: 'Mira' });
    expect(updateRecordRequestSchema.safeParse({ parentId: null }).success).toBe(true);
  });

  it('leaves fields loose in the generic schema and typed in the per-type one', () => {
    const patch = { fields: { goals: emptyRichText() } };
    expect(updateRecordRequestSchema.safeParse(patch).success).toBe(true);

    const typed = updateRecordRequestSchemaFor('npc').safeParse(patch);
    expect(typed.success).toBe(false);
    expect(typed.error?.issues[0]).toMatchObject({ path: ['fields'], keys: ['goals'] });

    expect(updateRecordRequestSchemaFor('npc').parse({ fields: { status: null } })).toEqual({
      fields: { status: null },
    });
    expect(updateRecordRequestSchemaFor('npc').safeParse({ fields: {} }).success).toBe(true);
  });
});

describe('recordSchema', () => {
  const base = {
    id: AREA_ID,
    name: 'Mira',
    publicDescription: emptyRichText(),
    gmNotes: emptyRichText(),
    tags: ['harbour'],
    parentId: null,
    statBlockId: null,
    revealedAt: null,
    source: 'manual',
    createdAt: '2026-11-09T10:00:00.000Z',
    updatedAt: '2026-11-09T10:00:00.000Z',
  };

  it('parses a record and types its fields by type', () => {
    const record = recordSchema.parse({
      ...base,
      type: 'npc',
      fields: { status: 'dead' },
      links: { homeSpot: [], factions: [] },
      otherLinks: [],
    });
    if (record.type === 'npc') {
      expect(record.fields.status).toBe('dead');
    } else {
      throw new Error('expected an npc');
    }
  });

  it("rejects fields from another type and a spot's missing fields object", () => {
    expect(
      recordSchema.safeParse({ ...base, type: 'npc', fields: { goals: emptyRichText() } }).success,
    ).toBe(false);
    expect(recordSchema.safeParse({ ...base, type: 'spot' }).success).toBe(false);
  });

  it('has a summary shape without rich text', () => {
    const summary = { ...base, type: 'npc', parentName: null };
    expect(recordSummarySchema.parse(summary)).toEqual({
      id: base.id,
      type: 'npc',
      name: base.name,
      tags: base.tags,
      parentId: null,
      parentName: null,
      revealedAt: null,
      createdAt: base.createdAt,
      updatedAt: base.updatedAt,
    });
  });

  it('accepts an optional type filter in the list query', () => {
    expect(recordListQuerySchema.parse({})).toEqual({});
    expect(recordListQuerySchema.parse({ type: 'lore' })).toEqual({ type: 'lore' });
    expect(recordListQuerySchema.safeParse({ type: 'monster' }).success).toBe(false);
  });
});

describe('recordListQuerySchema search and filters (F1.6)', () => {
  it('trims the search, and treats a blank one as none', () => {
    expect(recordListQuerySchema.parse({ q: '  mira  ' })).toEqual({ q: 'mira' });
    expect(recordListQuerySchema.parse({ q: '   ' })).toEqual({ q: undefined });
    expect(recordListQuerySchema.safeParse({ q: 'x'.repeat(200) }).success).toBe(true);
    expect(recordListQuerySchema.safeParse({ q: 'x'.repeat(201) }).success).toBe(false);
  });

  it('takes one tag or several, trimmed, at most 20', () => {
    expect(recordListQuerySchema.parse({ tag: ' harbour ' })).toEqual({ tag: ['harbour'] });
    expect(recordListQuerySchema.parse({ tag: ['a', 'b'] })).toEqual({ tag: ['a', 'b'] });
    expect(recordListQuerySchema.safeParse({ tag: '' }).success).toBe(false);
    const many = Array.from({ length: 21 }, (_, i) => `t${String(i)}`);
    expect(recordListQuerySchema.safeParse({ tag: many }).success).toBe(false);
  });

  it('takes an area id and a limit from 1 to 100', () => {
    expect(recordListQuerySchema.parse({ areaId: AREA_ID, limit: '8' })).toEqual({
      areaId: AREA_ID,
      limit: 8,
    });
    expect(recordListQuerySchema.safeParse({ areaId: 'nope' }).success).toBe(false);
    for (const limit of ['0', '101', '2.5', 'two']) {
      expect(recordListQuerySchema.safeParse({ limit }).success, limit).toBe(false);
    }
  });
});
