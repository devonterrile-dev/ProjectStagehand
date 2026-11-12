import type { ImportProposalDraft, ImportWireOutput, RecordType } from '@stagehand/shared';
import { describe, expect, it } from 'vitest';

import { harborPack, idMaker, IDS, newId, wire, wireCreate } from '../../test/import-fixtures';

import { emptyContextPack, type ContextPack } from './context';
import { validateImportOutput, type ValidationResult } from './validate';

interface Options {
  mode?: 'bootstrap' | 'add' | 'fill';
  targetTypes?: RecordType[];
  pack?: ContextPack;
}

function validate(output: ImportWireOutput, options: Options = {}): ValidationResult {
  return validateImportOutput({
    output,
    mode: options.mode ?? 'add',
    targetTypes: options.targetTypes ?? null,
    pack: options.pack ?? harborPack(),
    newId: idMaker(),
  });
}

/** The proposals of an answer that must be valid. */
function proposalsOf(output: ImportWireOutput, options: Options = {}): ImportProposalDraft[] {
  const result = validate(output, options);
  if (!result.ok) throw new Error(`expected a valid answer, got:\n${result.issues.join('\n')}`);
  return result.proposals;
}

/** The issues of an answer that must be refused. */
function issuesOf(output: ImportWireOutput, options: Options = {}): string[] {
  const result = validate(output, options);
  if (result.ok) throw new Error('expected the answer to be refused');
  return result.issues;
}

const text = (value: string) => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: value }] }],
});

describe('creates', () => {
  it('turns a new record into a create proposal with its own id', () => {
    const [proposal, ...rest] = proposalsOf(
      wire({
        creates: [
          wireCreate({
            id: 'N1',
            type: 'npc',
            name: '  Mira   Voss ',
            tags: [' harbor ', 'harbor', ''],
            fields: [
              { key: 'publicDescription', value: 'A dockhand with a limp.' },
              { key: 'appearance', value: ' Short, wiry. ' },
              { key: 'secrets', value: 'Sister of [[E3]].' },
              { key: 'status', value: 'Alive' },
              { key: 'wants', value: '   ' },
            ],
          }),
        ],
      }),
    );
    expect(rest).toEqual([]);
    expect(proposal).toEqual({
      action: 'create',
      payload: {
        id: newId(1),
        type: 'npc',
        name: 'Mira Voss',
        parentId: null,
        tags: ['harbor'],
        publicDescription: text('A dockhand with a limp.'),
        gmNotes: { type: 'doc', content: [{ type: 'paragraph' }] },
        fields: {
          appearance: 'Short, wiry.',
          secrets: {
            type: 'doc',
            content: [
              {
                type: 'paragraph',
                content: [
                  { type: 'text', text: 'Sister of ' },
                  {
                    type: 'mention',
                    attrs: { id: IDS.voss, label: 'Captain Voss', mentionSuggestionChar: '@' },
                  },
                  { type: 'text', text: '.' },
                ],
              },
            ],
          },
          status: 'alive',
        },
        links: {},
        otherLinks: [],
      },
    });
  });

  it('accepts field keys written a little differently', () => {
    const [proposal] = proposalsOf(
      wire({
        creates: [
          wireCreate({
            id: 'n1',
            type: 'npc',
            name: 'Mira',
            fields: [
              { key: 'public_description', value: 'Seen.' },
              { key: 'GM Notes', value: 'Kept.' },
              { key: 'voice_and_mannerisms', value: 'Clipped.' },
            ],
          }),
        ],
      }),
    );
    expect(proposal?.payload).toMatchObject({
      publicDescription: text('Seen.'),
      gmNotes: text('Kept.'),
      fields: { voiceAndMannerisms: 'Clipped.' },
    });
  });

  it('reads numbers and dates', () => {
    const [beat, notes] = proposalsOf(
      wire({
        creates: [
          wireCreate({
            id: 'N1',
            type: 'story_beat',
            name: 'The raid',
            fields: [
              { key: 'order', value: ' 3 ' },
              { key: 'status', value: 'PLANNED' },
            ],
          }),
          wireCreate({
            id: 'N2',
            type: 'session_notes',
            name: 'Session 4',
            fields: [
              { key: 'sessionNumber', value: '4' },
              { key: 'date', value: '2026-11-09' },
            ],
          }),
        ],
      }),
    );
    expect(beat?.payload).toMatchObject({ fields: { order: 3, status: 'planned' } });
    expect(notes?.payload).toMatchObject({ fields: { sessionNumber: 4, date: '2026-11-09' } });
  });

  it('writes a mention in a plain text field as the name', () => {
    const [proposal] = proposalsOf(
      wire({
        creates: [
          wireCreate({
            id: 'N1',
            type: 'item',
            name: 'Ledger',
            fields: [{ key: 'value', value: 'Priceless to [[E3]]' }],
          }),
        ],
      }),
    );
    expect(proposal?.payload).toMatchObject({ fields: { value: 'Priceless to Captain Voss' } });
  });

  it('puts a spot in an existing area or one created alongside it', () => {
    const proposals = proposalsOf(
      wire({
        creates: [
          wireCreate({ id: 'N1', type: 'spot', name: 'Fish market', area: 'E1' }),
          wireCreate({
            id: 'N2',
            type: 'spot',
            name: 'Lighthouse stair',
            area: 'N3',
            pointsOfInterest: [
              { name: ' Lamp room ', detail: 'Still warm. [[E3]] was here.' },
              { name: '', detail: 'dropped' },
            ],
          }),
          wireCreate({ id: 'N3', type: 'area', name: 'Gull Point', area: 'E1' }),
        ],
      }),
    );
    expect(proposals.map((proposal) => proposal.payload)).toMatchObject([
      { name: 'Fish market', parentId: IDS.saltmarsh },
      {
        name: 'Lighthouse stair',
        parentId: newId(3),
        fields: {
          pointsOfInterest: [{ name: 'Lamp room', detail: 'Still warm. Captain Voss was here.' }],
        },
      },
      // An area's own `area` is ignored.
      { name: 'Gull Point', parentId: null },
    ]);
  });

  it.each([
    ['no area', '', /must name its area/],
    ['an unknown area', 'E99', /must name its area/],
    ['a record that is not an area', 'E3', /must be a record of type area.*is a npc/],
  ])('refuses a spot with %s', (_name, area, message) => {
    const issues = issuesOf(
      wire({ creates: [wireCreate({ id: 'N1', type: 'spot', name: 'Fish market', area })] }),
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatch(message);
    expect(issues[0]).toContain('creates[0] "Fish market" (N1)');
  });

  it('refuses bad ids and names', () => {
    const issues = issuesOf(
      wire({
        creates: [
          wireCreate({ id: 'E7', type: 'npc', name: 'Wrong prefix' }),
          wireCreate({ id: 'N1', type: 'npc', name: 'First' }),
          wireCreate({ id: 'N1', type: 'npc', name: 'Second' }),
          wireCreate({ id: 'N2', type: 'npc', name: '   ' }),
          wireCreate({ id: 'N3', type: 'npc', name: 'x'.repeat(121) }),
        ],
      }),
    );
    expect(issues).toEqual([
      expect.stringContaining('must look like N1, N2'),
      expect.stringContaining('N1 is used by more than one new record'),
      expect.stringContaining('1 to 120 characters'),
      expect.stringContaining('1 to 120 characters'),
    ]);
  });

  it('refuses unknown fields, and says which fields exist', () => {
    const [issue] = issuesOf(
      wire({
        creates: [
          wireCreate({
            id: 'N1',
            type: 'item',
            name: 'Ledger',
            fields: [{ key: 'goals', value: 'x' }],
          }),
        ],
      }),
    );
    expect(issue).toContain('Item records have no field "goals"');
    expect(issue).toContain(
      'publicDescription, gmNotes, kind, appearance, effect, value, currentHolder, history',
    );
  });

  it('refuses values of the wrong shape', () => {
    const issues = issuesOf(
      wire({
        creates: [
          wireCreate({
            id: 'N1',
            type: 'story_beat',
            name: 'The raid',
            fields: [
              { key: 'status', value: 'soon' },
              { key: 'order', value: 'third' },
            ],
          }),
          wireCreate({
            id: 'N2',
            type: 'session_notes',
            name: 'Session 4',
            fields: [
              { key: 'date', value: 'last Tuesday' },
              { key: 'sessionNumber', value: '0' },
            ],
          }),
          wireCreate({
            id: 'N3',
            type: 'npc',
            name: 'Mira',
            fields: [{ key: 'appearance', value: 'x'.repeat(2001) }],
          }),
        ],
      }),
    );
    expect(issues).toEqual([
      expect.stringMatching(
        /field status must be one of planned, active, done, skipped, not "soon"/,
      ),
      expect.stringMatching(/field order must be a whole number/),
      // Schema issues come in the schema's field order.
      expect.stringMatching(/creates\[1\].*field sessionNumber: Session numbers start at 1/),
      expect.stringMatching(/creates\[1\].*field date: Use a date like/),
      expect.stringMatching(/creates\[2\].*field appearance: Must be 2000 characters or fewer/),
    ]);
  });

  it('points link fields and points of interest to where they belong', () => {
    const issues = issuesOf(
      wire({
        creates: [
          wireCreate({
            id: 'N1',
            type: 'npc',
            name: 'Mira',
            fields: [{ key: 'factions', value: 'E4' }],
          }),
          wireCreate({
            id: 'N2',
            type: 'spot',
            name: 'Fish market',
            area: 'E1',
            fields: [{ key: 'pointsOfInterest', value: '- stalls' }],
          }),
        ],
      }),
    );
    expect(issues).toEqual([
      expect.stringContaining('factions is a link field. Put it in links'),
      expect.stringContaining("pointsOfInterest goes in the record's pointsOfInterest list"),
    ]);
  });

  it('refuses a mention of a record nobody has', () => {
    const issues = issuesOf(
      wire({
        creates: [
          wireCreate({
            id: 'N1',
            type: 'npc',
            name: 'Mira',
            fields: [{ key: 'secrets', value: 'Fears [[E42]].' }],
          }),
        ],
      }),
    );
    expect(issues).toEqual([expect.stringContaining('field secrets mentions [[E42]]')]);
  });

  it('keeps to the type filter', () => {
    const output = wire({
      creates: [
        wireCreate({ id: 'N1', type: 'npc', name: 'Mira' }),
        wireCreate({ id: 'N2', type: 'item', name: 'Ledger' }),
      ],
    });
    expect(issuesOf(output, { targetTypes: ['npc'] })).toEqual([
      expect.stringContaining('allows new records only of type npc; this one is item'),
    ]);
    expect(proposalsOf(output, { targetTypes: ['npc', 'item'] })).toHaveLength(2);
  });

  it('caps how many records one answer may create', () => {
    const creates = Array.from({ length: 81 }, (_, index) =>
      wireCreate({ id: `N${String(index + 1)}`, type: 'npc', name: `Guard ${String(index + 1)}` }),
    );
    expect(issuesOf(wire({ creates }))).toEqual([
      expect.stringContaining('81 new records is more than'),
    ]);
  });

  it('works on an empty campaign', () => {
    const proposals = proposalsOf(
      wire({
        creates: [
          wireCreate({ id: 'N1', type: 'area', name: 'Saltmarsh' }),
          wireCreate({ id: 'N2', type: 'spot', name: 'Docks', area: 'N1' }),
        ],
      }),
      { mode: 'bootstrap', pack: emptyContextPack() },
    );
    expect(proposals).toHaveLength(2);
  });
});

describe('updates', () => {
  it('proposes only what changes', () => {
    const proposals = proposalsOf(
      wire({
        updates: [
          {
            id: 'e3',
            fields: [
              { key: 'status', value: 'missing' },
              // The same as what the record says already: no change.
              { key: 'appearance', value: 'Grey coat, salt-white beard.' },
              { key: 'publicDescription', value: 'The weathered captain of the Harbor Watch.' },
              { key: 'secrets', value: 'Takes coin from the [[E5]]. Now hunted by them.' },
              { key: 'name', value: 'Commander Voss' },
            ],
            addTags: ['harbor', 'missing'],
            pointsOfInterest: [],
          },
        ],
      }),
    );
    expect(proposals).toHaveLength(1);
    expect(proposals[0]).toMatchObject({
      action: 'update',
      payload: {
        recordId: IDS.voss,
        type: 'npc',
        name: 'Commander Voss',
        addTags: ['missing'],
        fields: { status: 'missing', secrets: { type: 'doc' } },
      },
    });
    const payload = proposals[0]?.payload as { fields: object; publicDescription?: unknown };
    expect(Object.keys(payload.fields)).toEqual(['secrets', 'status']);
    expect(payload.publicDescription).toBeUndefined();
  });

  it('drops an update that changes nothing', () => {
    const result = validate(
      wire({
        updates: [
          {
            id: 'E3',
            fields: [{ key: 'status', value: 'alive' }],
            addTags: ['harbor'],
            pointsOfInterest: [],
          },
        ],
        questions: ['Is Voss still captain?'],
      }),
    );
    expect(result).toEqual({ ok: true, proposals: [], questions: ['Is Voss still captain?'] });
  });

  it('refuses to update what the model could not read, or what does not exist', () => {
    const field = [{ key: 'gmNotes', value: 'More.' }];
    const issues = issuesOf(
      wire({
        creates: [wireCreate({ id: 'N1', type: 'npc', name: 'Mira' })],
        updates: [
          { id: 'E1', fields: field, addTags: [], pointsOfInterest: [] },
          { id: 'E77', fields: field, addTags: [], pointsOfInterest: [] },
          { id: 'N1', fields: field, addTags: [], pointsOfInterest: [] },
          { id: 'E3', fields: field, addTags: [], pointsOfInterest: [] },
          { id: 'E3', fields: field, addTags: [], pointsOfInterest: [] },
        ],
      }),
    );
    expect(issues).toEqual([
      expect.stringMatching(/updates\[0\] \(E1 "Saltmarsh"\): this record was not shown in full/),
      expect.stringMatching(/updates\[1\].*no existing record "E77"/),
      expect.stringMatching(/updates\[2\].*N1 is created in this answer/),
      expect.stringMatching(/updates\[4\].*E3 is updated more than once/),
    ]);
  });

  it('checks an update against the type of its record', () => {
    expect(
      issuesOf(
        wire({
          updates: [
            {
              id: 'E6',
              fields: [{ key: 'status', value: 'alive' }],
              addTags: [],
              pointsOfInterest: [],
            },
          ],
        }),
      ),
    ).toEqual([expect.stringContaining('Item records have no field "status"')]);
  });

  it('refuses any update on an empty campaign', () => {
    expect(
      issuesOf(
        wire({ updates: [{ id: 'E1', fields: [], addTags: ['x'], pointsOfInterest: [] }] }),
        { mode: 'bootstrap', pack: emptyContextPack() },
      ),
    ).toEqual([expect.stringContaining('no existing record "E1"')]);
  });
});

describe('links', () => {
  it('folds links from a new record into its create', () => {
    const proposals = proposalsOf(
      wire({
        creates: [
          wireCreate({ id: 'N1', type: 'npc', name: 'Mira' }),
          wireCreate({ id: 'N2', type: 'faction', name: 'Dockhands' }),
        ],
        links: [
          { from: 'N1', to: 'E2', field: 'homeSpot', label: '' },
          { from: 'N1', to: 'E4', field: 'factions', label: '' },
          { from: 'N1', to: 'N2', field: 'Factions', label: '' },
          { from: 'N1', to: 'N2', field: 'factions', label: '' },
          { from: 'N1', to: 'E3', field: '', label: '  sister   of ' },
          { from: 'N1', to: 'E3', field: '', label: 'again' },
          { from: 'N2', to: 'N1', field: 'members', label: '' },
        ],
      }),
    );
    expect(proposals).toHaveLength(2);
    expect(proposals[0]?.payload).toMatchObject({
      links: { homeSpot: [IDS.drownedRat], factions: [IDS.harborWatch, newId(2)] },
      otherLinks: [{ recordId: IDS.voss, label: 'sister of' }],
    });
    expect(proposals[1]?.payload).toMatchObject({ links: { members: [newId(1)] }, otherLinks: [] });
  });

  it('makes a link from an existing record its own proposal', () => {
    const proposals = proposalsOf(
      wire({
        creates: [wireCreate({ id: 'N1', type: 'npc', name: 'Mira' })],
        links: [
          { from: 'E4', to: 'N1', field: 'members', label: '' },
          { from: 'E4', to: 'N1', field: 'members', label: '' },
          { from: 'E5', to: 'E4', field: '', label: 'at war with' },
          { from: 'E2', to: 'E3', field: '', label: '' },
        ],
      }),
    );
    expect(proposals.slice(1)).toEqual([
      {
        action: 'link',
        payload: {
          fromId: IDS.harborWatch,
          fromType: 'faction',
          toId: newId(1),
          fieldKey: 'members',
          label: null,
        },
      },
      {
        action: 'link',
        payload: {
          fromId: IDS.tidecallers,
          fromType: 'faction',
          toId: IDS.harborWatch,
          fieldKey: null,
          label: 'at war with',
        },
      },
      {
        action: 'link',
        payload: {
          fromId: IDS.drownedRat,
          fromType: 'spot',
          toId: IDS.voss,
          fieldKey: null,
          label: null,
        },
      },
    ]);
  });

  it('skips links a fully shown record already has', () => {
    expect(
      proposalsOf(
        wire({
          links: [
            { from: 'E3', to: 'E4', field: 'factions', label: '' },
            { from: 'E3', to: 'E6', field: '', label: 'carries' },
            { from: 'E6', to: 'E3', field: 'currentHolder', label: '' },
          ],
        }),
      ),
    ).toEqual([]);
  });

  it('cuts a long relationship short', () => {
    const [proposal] = proposalsOf(
      wire({ links: [{ from: 'E5', to: 'E4', field: '', label: 'x'.repeat(90) }] }),
    );
    expect((proposal?.payload as { label: string }).label).toHaveLength(60);
  });

  it('refuses links that cannot be made', () => {
    const issues = issuesOf(
      wire({
        creates: [wireCreate({ id: 'N1', type: 'npc', name: 'Mira' })],
        links: [
          { from: 'N1', to: 'E99', field: '', label: 'knows' },
          { from: 'E3', to: 'E3', field: '', label: 'is' },
          { from: 'N1', to: 'E4', field: 'members', label: '' },
          { from: 'N1', to: 'E3', field: 'factions', label: '' },
          { from: 'N1', to: 'E2', field: 'homeSpot', label: '' },
          { from: 'N1', to: 'E2', field: 'homeSpot', label: '' },
          { from: 'E6', to: 'E1', field: 'currentHolder', label: '' },
          { from: 'E6', to: 'E2', field: 'currentHolder', label: '' },
        ],
      }),
    );
    expect(issues).toEqual([
      expect.stringMatching(/links\[0\].*"E99" is neither an existing record/),
      expect.stringMatching(/links\[1\].*can't link to itself/),
      expect.stringMatching(
        /links\[2\].*NPC records have no link field "members". Theirs are: homeSpot, factions/,
      ),
      expect.stringMatching(
        /links\[3\].*factions can only link records of type faction, but E3 \("Captain Voss"\) is a npc/,
      ),
      expect.stringMatching(
        /links\[7\].*currentHolder holds one record, and this answer gives it more than one/,
      ),
    ]);
  });

  it('refuses a second record in a one-record field of a new record', () => {
    const issues = issuesOf(
      wire({
        creates: [wireCreate({ id: 'N1', type: 'item', name: 'Ledger' })],
        links: [
          { from: 'N1', to: 'E3', field: 'currentHolder', label: '' },
          { from: 'N1', to: 'E2', field: 'currentHolder', label: '' },
        ],
      }),
    );
    expect(issues).toEqual([
      expect.stringContaining('currentHolder holds one record, and this record already has one'),
    ]);
  });

  it('explains a type with no link fields at all', () => {
    const pack = emptyContextPack();
    const issues = issuesOf(
      wire({
        creates: [
          wireCreate({ id: 'N1', type: 'area', name: 'Saltmarsh' }),
          wireCreate({ id: 'N2', type: 'npc', name: 'Mira' }),
        ],
        links: [{ from: 'N2', to: 'N1', field: 'homeArea', label: '' }],
      }),
      { mode: 'bootstrap', pack },
    );
    expect(issues[0]).toContain('NPC records have no link field "homeArea"');
  });
});

describe('fill mode', () => {
  const fillPack = () => {
    const pack = harborPack();
    pack.fillTargetId = IDS.voss;
    return pack;
  };

  it('fills empty fields and leaves filled ones alone', () => {
    const proposals = proposalsOf(
      wire({
        updates: [
          {
            id: 'E3',
            fields: [
              { key: 'personality', value: 'Tired, fair, slow to anger.' },
              { key: 'appearance', value: 'Something else entirely.' },
              { key: 'status', value: 'dead' },
              { key: 'publicDescription', value: 'Rewritten.' },
              { key: 'gmNotes', value: 'Owes the Watch his career.' },
              { key: 'name', value: 'Someone else' },
            ],
            addTags: [],
            pointsOfInterest: [],
          },
        ],
        links: [{ from: 'E3', to: 'E2', field: 'homeSpot', label: '' }],
      }),
      { mode: 'fill', pack: fillPack() },
    );
    expect(proposals).toHaveLength(2);
    const payload = proposals[0]?.payload as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual(['fields', 'gmNotes', 'recordId', 'type']);
    expect(Object.keys(payload['fields'] as object)).toEqual(['personality']);
    expect(proposals[1]).toMatchObject({ action: 'link', payload: { fieldKey: 'homeSpot' } });
  });

  it('creates nothing and touches no other record', () => {
    const issues = issuesOf(
      wire({
        creates: [wireCreate({ id: 'N1', type: 'npc', name: 'Mira' })],
        updates: [
          {
            id: 'E6',
            fields: [{ key: 'value', value: 'High' }],
            addTags: [],
            pointsOfInterest: [],
          },
        ],
        links: [{ from: 'E6', to: 'E2', field: '', label: 'lost in' }],
      }),
      { mode: 'fill', pack: fillPack() },
    );
    expect(issues).toEqual([
      expect.stringContaining('fill mode, which creates no records'),
      expect.stringContaining('fill mode changes only the record named in the task'),
      // The link's from-record was never created, so it has no target either.
      expect.stringContaining('fill mode adds links only from the record named in the task'),
    ]);
  });
});

describe('questions', () => {
  it('tidies questions and caps their number and length', () => {
    const result = validate(
      wire({
        questions: [
          '  Is Mira   older? ',
          '',
          'x'.repeat(600),
          ...Array.from({ length: 30 }, (_, i) => `Q${String(i)}?`),
        ],
      }),
    );
    if (!result.ok) throw new Error('expected a valid answer');
    expect(result.questions).toHaveLength(20);
    expect(result.questions[0]).toBe('Is Mira older?');
    expect(result.questions[1]).toHaveLength(500);
  });

  it('accepts an answer with nothing in it', () => {
    expect(validate(wire())).toEqual({ ok: true, proposals: [], questions: [] });
  });
});
