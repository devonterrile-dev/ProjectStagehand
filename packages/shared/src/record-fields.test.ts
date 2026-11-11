import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  applyFieldsPatch,
  fieldsPatchSchemaFor,
  fieldsSchemaFor,
  RECORD_FIELD_SPECS,
  RECORD_TYPE_LABELS,
  RECORD_TYPES,
  recordFieldsSchemas,
  recordTypeSchema,
  type FieldSpec,
  type RecordType,
} from './record-fields';
import { emptyRichText, recordRichTextSchema, type RichText } from './rich-text';

const rich = (text: string): RichText => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
});

/** A full, valid `fields` object for every type. */
const FULL_FIELDS: Record<RecordType, Record<string, unknown>> = {
  npc: {
    appearance: 'Tall, salt-stained coat',
    personality: rich('Gruff but fair'),
    voiceAndMannerisms: 'Low voice, taps the table',
    wants: rich('To find her brother'),
    knowledge: rich('Knows the tide schedule'),
    secrets: rich('Smuggles for the Tide Guild'),
    roleInStory: rich('Reluctant ally'),
    status: 'alive',
  },
  area: {
    kindOfPlace: 'Harbour town',
    overview: rich('Built on stilts'),
    atmosphere: rich('Gulls, brine, creaking rope'),
    notableFeatures: rich('The drowned bell tower'),
    hooks: rich('A ship that never docks'),
    secrets: rich('The mayor is a mimic'),
  },
  spot: {
    readAloud: rich('Stalls bob on barrels'),
    pointsOfInterest: [{ name: 'Fishmonger', detail: 'Sells more than fish' }],
    hiddenDetails: rich('A trapdoor under the fish crates'),
    backdropNotes: 'Wide dock at dusk',
  },
  faction: {
    goals: rich('Control the harbour'),
    resources: rich('Three ships, one judge'),
    publicReputation: rich('Honest traders'),
    secrets: rich('They sank the Marigold'),
  },
  lore: {
    category: 'Religion',
    summary: rich('The Drowned God sleeps'),
    fullDetails: rich('Long ago…'),
    trueVsBelieved: rich('He is awake'),
  },
  story_beat: {
    arcName: 'The Marigold',
    order: 2,
    summary: rich('The wreck is found'),
    trigger: rich('The party reaches the reef'),
    possibleOutcomes: rich('They recover the bell'),
    status: 'planned',
  },
  item: {
    kind: 'Relic',
    appearance: 'A bronze bell the size of a fist',
    effect: rich('Rings when lies are told'),
    value: 'Priceless to the Guild',
    history: rich('Cast for the Marigold'),
  },
  session_notes: {
    sessionNumber: 3,
    date: '2026-11-09',
    gmRecap: rich('The party found the bell'),
    keyEvents: rich('Fight on the dock'),
    openThreads: rich('Who hired the divers?'),
    prepForNextTime: rich('Stat the mimic mayor'),
  },
};

describe('record types', () => {
  it('lists the eight types in governance order, each with a label and a spec', () => {
    expect(recordTypeSchema.options).toEqual([
      'npc',
      'area',
      'spot',
      'faction',
      'lore',
      'story_beat',
      'item',
      'session_notes',
    ]);
    expect(Object.keys(RECORD_TYPE_LABELS)).toEqual([...RECORD_TYPES]);
    expect(Object.keys(RECORD_FIELD_SPECS)).toEqual([...RECORD_TYPES]);
  });
});

describe.each(RECORD_TYPES)('%s fields', (type) => {
  const schema = fieldsSchemaFor(type);

  it('accepts no fields at all and a full set', () => {
    expect(schema.parse({})).toEqual({});
    expect(schema.parse(FULL_FIELDS[type])).toEqual(FULL_FIELDS[type]);
  });

  it('rejects unknown fields', () => {
    expect(schema.safeParse({ ...FULL_FIELDS[type], bogus: 'x' }).success).toBe(false);
  });

  it('matches its display spec: same keys, and kinds that fit the schema', () => {
    const shape = recordFieldsSchemas[type].shape as Record<string, z.ZodOptional<z.ZodType>>;
    const spec = RECORD_FIELD_SPECS[type] as Record<
      string,
      {
        kind: string;
        options?: readonly string[];
        targets?: readonly string[];
        cardinality?: string;
      }
    >;
    const stored = Object.entries(spec).filter(([, field]) => field.kind !== 'links');

    expect(stored.map(([key]) => key).sort()).toEqual(Object.keys(shape).sort());

    for (const [key, field] of stored) {
      const inner = shape[key]?.unwrap();
      switch (field.kind) {
        case 'rich':
          expect(inner, key).toBe(recordRichTextSchema);
          break;
        case 'enum':
          expect(inner, key).toBeInstanceOf(z.ZodEnum);
          expect((inner as z.ZodEnum).options, key).toEqual(field.options);
          break;
        case 'text':
          expect(inner, key).toBeInstanceOf(z.ZodString);
          break;
        case 'date':
          expect(inner, key).toBeInstanceOf(z.ZodISODate);
          break;
        case 'number':
          expect(inner, key).toBeInstanceOf(z.ZodNumber);
          break;
        case 'list':
          expect(inner, key).toBeInstanceOf(z.ZodArray);
          break;
        default:
          throw new Error(`unexpected kind ${field.kind} on ${key}`);
      }
    }
  });

  it('gives every link field its targets and cardinality, and keeps it out of fields', () => {
    const shape = recordFieldsSchemas[type].shape as Record<string, unknown>;
    const specs: Record<string, FieldSpec> = RECORD_FIELD_SPECS[type];
    for (const [key, field] of Object.entries(specs)) {
      if (field.kind !== 'links') continue;
      expect(shape[key], key).toBeUndefined();
      expect(field.targets.length, key).toBeGreaterThan(0);
      for (const target of field.targets) expect(RECORD_TYPES, key).toContain(target);
      expect(['one', 'many'], key).toContain(field.cardinality);
    }
  });

  it('has a patch schema that accepts null for every field and rejects unknown ones', () => {
    const nulls = Object.fromEntries(Object.keys(FULL_FIELDS[type]).map((key) => [key, null]));
    expect(fieldsPatchSchemaFor(type).parse(nulls)).toEqual(nulls);
    expect(fieldsPatchSchemaFor(type).safeParse({ bogus: null }).success).toBe(false);
  });
});

describe('field validation details', () => {
  it('checks enums, numbers and dates', () => {
    expect(fieldsSchemaFor('npc').safeParse({ status: 'undead' }).success).toBe(false);
    expect(fieldsSchemaFor('story_beat').safeParse({ order: -1 }).success).toBe(false);
    expect(fieldsSchemaFor('story_beat').safeParse({ order: 1.5 }).success).toBe(false);
    expect(fieldsSchemaFor('session_notes').safeParse({ sessionNumber: 0 }).success).toBe(false);
    expect(fieldsSchemaFor('session_notes').safeParse({ date: '9/11/2026' }).success).toBe(false);
    expect(fieldsSchemaFor('session_notes').safeParse({ date: '2026-11-09' }).success).toBe(true);
  });

  it('trims text fields and validates rich text fields', () => {
    expect(fieldsSchemaFor('npc').parse({ appearance: '  tall  ' })).toEqual({
      appearance: 'tall',
    });
    expect(fieldsSchemaFor('npc').safeParse({ appearance: 'a'.repeat(2001) }).success).toBe(false);
    expect(fieldsSchemaFor('npc').safeParse({ personality: 'plain string' }).success).toBe(false);
    expect(fieldsSchemaFor('npc').safeParse({ personality: emptyRichText() }).success).toBe(true);
  });

  it('checks points of interest', () => {
    const spot = fieldsSchemaFor('spot');
    expect(spot.safeParse({ pointsOfInterest: [{ name: '', detail: 'x' }] }).success).toBe(false);
    expect(
      spot.safeParse({ pointsOfInterest: [{ name: 'Well', detail: 'x', secret: true }] }).success,
    ).toBe(false);
    expect(spot.safeParse({ pointsOfInterest: [{ name: 'Well', detail: '' }] }).success).toBe(true);
  });
});

describe('applyFieldsPatch', () => {
  const stored = { appearance: 'Tall', status: 'alive' };

  it('overwrites present keys and keeps the rest', () => {
    expect(applyFieldsPatch('npc', stored, { status: 'dead' })).toEqual({
      appearance: 'Tall',
      status: 'dead',
    });
  });

  it('removes a key on null and ignores undefined', () => {
    expect(applyFieldsPatch('npc', stored, { appearance: null, status: undefined })).toEqual({
      status: 'alive',
    });
  });

  it('re-checks the merged result against the full schema', () => {
    expect(() => applyFieldsPatch('npc', stored, { status: 'undead' })).toThrow();
  });
});
