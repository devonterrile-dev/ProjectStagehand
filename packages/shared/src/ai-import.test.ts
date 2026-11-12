import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  addTokenUsage,
  AI_IMPORT_LIMITS,
  AI_IMPORT_MODEL,
  AI_MODEL_PRICES,
  createProposalPayloadSchema,
  emptyTokenUsage,
  estimateCostUsd,
  importWireSchema,
  linkProposalPayloadSchema,
  startImportRequestSchema,
  updateProposalPayloadSchema,
} from './ai-import';
import { emptyRichText, type RichText } from './rich-text';

const ID_A = '11111111-1111-4111-8111-111111111111';
const ID_B = '22222222-2222-4222-8222-222222222222';

const doc = (text: string): RichText => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
});

describe('importWireSchema', () => {
  it('accepts a full answer', () => {
    const answer = {
      creates: [
        {
          id: 'N1',
          type: 'npc',
          name: 'Mira',
          area: '',
          tags: ['harbor'],
          fields: [{ key: 'status', value: 'alive' }],
          pointsOfInterest: [],
        },
      ],
      updates: [{ id: 'E1', fields: [], addTags: ['met'], pointsOfInterest: [] }],
      links: [{ from: 'N1', to: 'E1', field: 'factions', label: '' }],
      questions: ['Is Mira a member or a hireling?'],
    };
    expect(importWireSchema.parse(answer)).toEqual(answer);
  });

  it('stays inside what structured output can compile', () => {
    // Anthropic refuses recursive schemas and allows at most 24 optional and 16 union-typed
    // properties, so the wire schema has none of either (D-27).
    const json = JSON.stringify(z.toJSONSchema(importWireSchema));
    expect(json).not.toContain('"anyOf"');
    expect(json).not.toContain('"oneOf"');
    expect(json).not.toContain('"$ref"');

    const optional: string[] = [];
    const visit = (node: unknown, path: string): void => {
      if (typeof node !== 'object' || node === null) return;
      const schema = node as { properties?: Record<string, unknown>; required?: string[] };
      for (const [key, child] of Object.entries(schema.properties ?? {})) {
        if (!(schema.required ?? []).includes(key)) optional.push(`${path}.${key}`);
        visit(child, `${path}.${key}`);
      }
      for (const [key, child] of Object.entries(node)) {
        if (key !== 'properties') visit(child, path);
      }
    };
    visit(z.toJSONSchema(importWireSchema), '');
    expect(optional).toEqual([]);
  });
});

describe('createProposalPayloadSchema', () => {
  const npc = {
    id: ID_A,
    type: 'npc',
    name: 'Mira',
    parentId: null,
    tags: [],
    publicDescription: doc('A dockhand.'),
    gmNotes: emptyRichText(),
    fields: { status: 'alive', secrets: doc('She saw the wreck.') },
    links: { factions: [ID_B] },
    otherLinks: [],
  };

  it('accepts a record of a type with its own fields and links', () => {
    expect(createProposalPayloadSchema.safeParse(npc).success).toBe(true);
  });

  it("refuses a field or link field the type doesn't have", () => {
    expect(
      createProposalPayloadSchema.safeParse({ ...npc, fields: { goals: doc('x') } }).success,
    ).toBe(false);
    expect(
      createProposalPayloadSchema.safeParse({ ...npc, links: { members: [ID_B] } }).success,
    ).toBe(false);
  });

  it('refuses a bad field value and says where', () => {
    const parsed = createProposalPayloadSchema.safeParse({ ...npc, fields: { status: 'asleep' } });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.path).toEqual(['fields', 'status']);
  });

  it('needs an area for a spot, and only for a spot', () => {
    const spot = { ...npc, type: 'spot', fields: {}, links: {} };
    expect(createProposalPayloadSchema.safeParse(spot).success).toBe(false);
    expect(createProposalPayloadSchema.safeParse({ ...spot, parentId: ID_B }).success).toBe(true);
    expect(createProposalPayloadSchema.safeParse({ ...npc, parentId: ID_B }).success).toBe(false);
  });
});

describe('updateProposalPayloadSchema', () => {
  it('accepts any one change', () => {
    for (const change of [
      { name: 'Captain Voss' },
      { gmNotes: doc('Now missing.') },
      { addTags: ['missing'] },
      { fields: { status: 'missing' } },
    ]) {
      const parsed = updateProposalPayloadSchema.safeParse({
        recordId: ID_A,
        type: 'npc',
        ...change,
      });
      expect(parsed.success, JSON.stringify(change)).toBe(true);
    }
  });

  it('refuses an update that changes nothing', () => {
    for (const empty of [{}, { addTags: [] }, { fields: {} }]) {
      expect(
        updateProposalPayloadSchema.safeParse({ recordId: ID_A, type: 'npc', ...empty }).success,
      ).toBe(false);
    }
  });

  it('checks fields against the record type', () => {
    expect(
      updateProposalPayloadSchema.safeParse({
        recordId: ID_A,
        type: 'item',
        fields: { status: 'missing' },
      }).success,
    ).toBe(false);
  });
});

describe('linkProposalPayloadSchema', () => {
  const link = { fromId: ID_A, fromType: 'faction', toId: ID_B, fieldKey: 'leaders', label: null };

  it('accepts a field link and a free-form link', () => {
    expect(linkProposalPayloadSchema.safeParse(link).success).toBe(true);
    expect(
      linkProposalPayloadSchema.safeParse({ ...link, fieldKey: null, label: 'funded by' }).success,
    ).toBe(true);
    expect(
      linkProposalPayloadSchema.safeParse({ ...link, fieldKey: null, label: null }).success,
    ).toBe(true);
  });

  it('refuses a self link, an unknown field and a labelled field link', () => {
    expect(linkProposalPayloadSchema.safeParse({ ...link, toId: ID_A }).success).toBe(false);
    expect(linkProposalPayloadSchema.safeParse({ ...link, fieldKey: 'homeSpot' }).success).toBe(
      false,
    );
    expect(linkProposalPayloadSchema.safeParse({ ...link, label: 'boss' }).success).toBe(false);
  });
});

describe('startImportRequestSchema', () => {
  it('accepts each mode', () => {
    expect(
      startImportRequestSchema.safeParse({ mode: 'bootstrap', text: 'A port town.' }).success,
    ).toBe(true);
    expect(
      startImportRequestSchema.safeParse({
        mode: 'add',
        text: ' A smuggler. ',
        targetTypes: ['npc'],
      }).data,
    ).toEqual({ mode: 'add', text: 'A smuggler.', targetTypes: ['npc'] });
    expect(
      startImportRequestSchema.safeParse({ mode: 'fill', text: '', recordId: ID_A }).success,
    ).toBe(true);
  });

  it('needs notes unless it fills in a record', () => {
    expect(startImportRequestSchema.safeParse({ mode: 'add', text: '   ' }).success).toBe(false);
  });

  it('ties the record and the type filter to the right modes', () => {
    expect(startImportRequestSchema.safeParse({ mode: 'fill', text: '' }).success).toBe(false);
    expect(
      startImportRequestSchema.safeParse({ mode: 'add', text: 'x', recordId: ID_A }).success,
    ).toBe(false);
    expect(
      startImportRequestSchema.safeParse({
        mode: 'fill',
        text: '',
        recordId: ID_A,
        targetTypes: ['npc'],
      }).success,
    ).toBe(false);
    expect(
      startImportRequestSchema.safeParse({ mode: 'add', text: 'x', targetTypes: ['npc', 'npc'] })
        .success,
    ).toBe(false);
  });

  it('caps the notes', () => {
    const text = 'a'.repeat(AI_IMPORT_LIMITS.inputMaxChars + 1);
    expect(startImportRequestSchema.safeParse({ mode: 'add', text }).success).toBe(false);
  });
});

describe('token usage and cost', () => {
  it('adds usage field by field', () => {
    const one = { inputTokens: 100, outputTokens: 20, cacheReadTokens: 5, cacheWriteTokens: 1 };
    expect(addTokenUsage(emptyTokenUsage(), one)).toEqual(one);
    expect(addTokenUsage(one, one).inputTokens).toBe(200);
  });

  it('prices every kind of token', () => {
    expect(AI_MODEL_PRICES[AI_IMPORT_MODEL]).toBeDefined();
    const cost = estimateCostUsd(AI_IMPORT_MODEL, {
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      cacheReadTokens: 1_000_000,
      cacheWriteTokens: 1_000_000,
    });
    expect(cost).toBeCloseTo(2 + 10 + 0.1 + 2.5);
  });

  it('gives no estimate for a model without a listed price', () => {
    expect(estimateCostUsd('some-future-model', emptyTokenUsage())).toBeNull();
  });
});
