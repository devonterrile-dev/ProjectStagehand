import { describe, expect, it } from 'vitest';

import { RECORD_TYPES } from './record-fields';
import {
  emptyLinksFor,
  INVERSE_LINK_FIELDS,
  inverseLinkFieldsOf,
  LINK_LABEL_MAX,
  linkFieldSpec,
  linkFieldsOf,
  linksPatchSchemaFor,
  linkTargetsLabel,
  linksSchemaFor,
  mentionIdsOfRecord,
  OTHER_LINKS_MAX,
  otherLinksSchema,
} from './record-links';
import { createRecordRequestSchema, updateRecordRequestSchemaFor } from './records';
import { emptyRichText, type RichText } from './rich-text';

const A = '0b7e2f1c-3c1d-4b8a-9a50-6f2a0e1d9c11';
const B = '9f0c2d4e-6a8b-4c1d-8e3f-5a7b9c1d3e5f';
const C = '1a2b3c4d-5e6f-4a8b-9c0d-1e2f3a4b5c6d';

const mentioning = (...ids: string[]): RichText => ({
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: ids.map((id) => ({ type: 'mention', attrs: { id, label: 'Someone' } })),
    },
  ],
});

describe('link field specs', () => {
  it('lists the link fields of a type in display order', () => {
    expect(linkFieldsOf('npc').map(([key]) => key)).toEqual(['homeSpot', 'factions']);
    expect(linkFieldsOf('faction').map(([key]) => key)).toEqual([
      'leaders',
      'members',
      'alliesAndEnemies',
    ]);
    expect(linkFieldSpec('npc', 'homeSpot')).toMatchObject({
      targets: ['spot'],
      cardinality: 'one',
    });
    expect(linkFieldSpec('npc', 'personality')).toBeUndefined();
    expect(linkFieldSpec('npc', 'leaders')).toBeUndefined();
  });

  it('names target lists for messages', () => {
    expect(linkTargetsLabel(['spot'])).toBe('Spots');
    expect(linkTargetsLabel(['npc', 'faction'])).toBe('NPCs or Factions');
    expect(linkTargetsLabel(['npc', 'area', 'spot', 'item'])).toBe('NPCs, Areas, Spots or Items');
  });

  it.each(RECORD_TYPES)('gives %s an empty list per link field', (type) => {
    const empty = emptyLinksFor(type);
    expect(Object.keys(empty)).toEqual(linkFieldsOf(type).map(([key]) => key));
    expect(linksSchemaFor(type).parse(empty)).toEqual(empty);
  });
});

describe('linksPatchSchemaFor', () => {
  it('takes any subset of the link fields, an empty list clearing one', () => {
    const schema = linksPatchSchemaFor('npc');
    expect(schema.parse({ factions: [A, B] })).toEqual({ factions: [A, B] });
    expect(schema.parse({ homeSpot: [] })).toEqual({ homeSpot: [] });
    expect(schema.parse({})).toEqual({});
  });

  it('refuses unknown keys, value fields, a second record on a one field and duplicates', () => {
    const schema = linksPatchSchemaFor('npc');
    expect(schema.safeParse({ leaders: [A] }).success).toBe(false);
    expect(schema.safeParse({ personality: [A] }).success).toBe(false);
    expect(schema.safeParse({ homeSpot: [A, B] }).error?.issues[0]?.message).toBe(
      'Home spot holds one record',
    );
    expect(schema.safeParse({ factions: [A, A] }).error?.issues[0]?.message).toBe(
      'Each record can only be linked once',
    );
    expect(schema.safeParse({ factions: ['nope'] }).success).toBe(false);
  });

  it('is what record PATCH and create use for links', () => {
    expect(updateRecordRequestSchemaFor('spot').parse({ links: { npcsHere: [A] } })).toEqual({
      links: { npcsHere: [A] },
    });
    expect(
      updateRecordRequestSchemaFor('spot').safeParse({ links: { homeSpot: [A] } }).success,
    ).toBe(false);
    expect(
      createRecordRequestSchema.parse({ type: 'npc', name: 'Mira', links: { homeSpot: [A] } }),
    ).toEqual({ type: 'npc', name: 'Mira', links: { homeSpot: [A] } });
  });
});

describe('otherLinksSchema', () => {
  it('takes record ids with an optional trimmed label', () => {
    expect(
      otherLinksSchema.parse([
        { recordId: A, label: '  rival of ' },
        { recordId: B, label: null },
      ]),
    ).toEqual([
      { recordId: A, label: 'rival of' },
      { recordId: B, label: null },
    ]);
  });

  it('refuses blank or long labels, duplicates and too many links', () => {
    expect(otherLinksSchema.safeParse([{ recordId: A, label: '  ' }]).success).toBe(false);
    expect(
      otherLinksSchema.safeParse([{ recordId: A, label: 'x'.repeat(LINK_LABEL_MAX + 1) }]).success,
    ).toBe(false);
    expect(
      otherLinksSchema.safeParse([
        { recordId: A, label: null },
        { recordId: A, label: 'twice' },
      ]).success,
    ).toBe(false);
    expect(
      otherLinksSchema.safeParse(
        Array.from({ length: OTHER_LINKS_MAX + 1 }, () => ({
          recordId: crypto.randomUUID(),
          label: null,
        })),
      ).success,
    ).toBe(false);
    expect(otherLinksSchema.safeParse([{ recordId: A }]).success).toBe(false);
  });
});

describe('mentionIdsOfRecord', () => {
  it('collects mentions from the public description, GM notes and rich fields only', () => {
    expect(
      mentionIdsOfRecord('npc', {
        publicDescription: mentioning(A),
        gmNotes: mentioning(B, A),
        fields: { secrets: mentioning(C), appearance: 'not rich text' },
      }),
    ).toEqual([A, B, C]);
  });

  it('skips missing or empty values', () => {
    expect(mentionIdsOfRecord('lore', { publicDescription: emptyRichText() })).toEqual([]);
    expect(mentionIdsOfRecord('spot', { fields: { readAloud: null } })).toEqual([]);
  });
});

describe('inverse link fields (F1.10)', () => {
  it("shows a Spot's Props from each Prop's one Spot link", () => {
    expect(inverseLinkFieldsOf('spot')).toEqual([
      ['propsHere', { label: 'Props here', from: 'prop', field: 'spot' }],
    ]);
    expect(inverseLinkFieldsOf('npc')).toEqual([]);
  });

  it('points every inverse list at a real link field that targets the showing type', () => {
    for (const [type, fields] of Object.entries(INVERSE_LINK_FIELDS)) {
      for (const [key, inverse] of Object.entries(fields)) {
        const spec = linkFieldSpec(inverse.from, inverse.field);
        expect(spec, key).toBeDefined();
        expect(spec?.targets, key).toContain(type);
        // Never also a stored link field of the showing type: one fact, one row.
        expect(linkFieldSpec(type as never, key), key).toBeUndefined();
      }
    }
  });
});
