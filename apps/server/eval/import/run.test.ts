/**
 * Proves the eval's runner and grader before anything is paid for (F1.9b): a perfect answer
 * to every case scores 100%, an empty one fails, and each check catches the mistake it is
 * there for. The model is faked; nothing here calls Anthropic.
 */
import type { ImportWireOutput } from '@stagehand/shared';
import { describe, expect, it } from 'vitest';

import { wire, wireCreate } from '../../test/import-fixtures';
import type { ImportCallInput, ImportCallResult } from '../../src/providers/anthropic';

import { EVAL_CASES } from './cases';
import { sameThing } from './grade';
import { runCase, type RunSettings } from './run';

const MODEL = 'claude-sonnet-5-5';
const USAGE = { inputTokens: 1000, outputTokens: 500, cacheReadTokens: 0, cacheWriteTokens: 0 };

/** The ref (`E3`) the context pack gave a record, read from the message sent. */
function refIn(prefix: string, name: string): string {
  const line = prefix.split('\n').find((candidate) => candidate.includes(`| ${name}`));
  const ref = line?.split(' | ')[0];
  if (ref === undefined) throw new Error(`"${name}" is not in the context pack`);
  return ref;
}

const field = (key: string, value: string) => ({ key, value });
const update = (id: string, fields: { key: string; value: string }[]) => ({
  id,
  fields,
  addTags: [],
});

interface Answers {
  questions?: string[];
  records: (ref: (name: string) => string) => ImportWireOutput;
}

/** A perfect answer for every step of every case, by case id. */
const ORACLE: Record<string, Answers[]> = {
  marsh: [
    {
      questions: ['The notes call the Keeper both she and he. Which is right?'],
      records: () =>
        wire({
          creates: [
            wireCreate({ id: 'N1', type: 'area', name: 'Reedholm' }),
            wireCreate({ id: 'N2', type: 'spot', name: 'The Mooring Hall', area: 'N1' }),
            wireCreate({ id: 'N3', type: 'spot', name: "Widow Pell's Teahouse", area: 'N1' }),
            wireCreate({
              id: 'N4',
              type: 'faction',
              name: 'The Order of the Wick',
              fields: [
                field('publicDescription', 'Kindly lantern tenders in grey oilskins.'),
                field('secrets', 'They lure travellers into the deep channels and drown them.'),
              ],
            }),
            wireCreate({ id: 'N5', type: 'faction', name: 'The Eel Guild' }),
            wireCreate({
              id: 'N6',
              type: 'npc',
              name: 'The Keeper',
              fields: [field('appearance', 'An old woman with milky eyes.')],
            }),
            wireCreate({ id: 'N7', type: 'npc', name: 'Brannoc Tull' }),
          ],
          links: [{ from: 'N6', to: 'N4', field: 'factions', label: '' }],
        }),
    },
    {
      records: (ref) =>
        wire({
          creates: [
            wireCreate({ id: 'N1', type: 'item', name: 'The Glass Heart' }),
            wireCreate({ id: 'N2', type: 'npc', name: 'Sefa' }),
          ],
          updates: [
            update(ref('Brannoc Tull'), [
              field('gmNotes', 'Owes the Eel Guild itself. Stealth DC 14 to follow his boat.'),
            ]),
          ],
        }),
    },
    {
      records: (ref) =>
        wire({
          updates: [
            update(ref('The Glass Heart'), [
              field('appearance', 'A lantern of cloudy green sea-glass with an eye-shaped flame.'),
            ]),
          ],
        }),
    },
  ],
  'terse-npc': [
    { records: () => wire({ creates: [wireCreate({ id: 'N1', type: 'npc', name: 'Hobb' })] }) },
  ],
  'rambling-city': [
    {
      records: () =>
        wire({
          creates: [
            wireCreate({ id: 'N1', type: 'area', name: 'Saltreach' }),
            wireCreate({ id: 'N2', type: 'spot', name: 'The Gull Market', area: 'N1' }),
            wireCreate({
              id: 'N3',
              type: 'spot',
              name: 'The Copper Kettle',
              area: 'N1',
              fields: [
                field('publicDescription', 'A steamy bathhouse in the Gutters.'),
                field('hiddenDetails', 'A front for a gambling den.'),
              ],
            }),
            wireCreate({ id: 'N4', type: 'spot', name: 'The Old Lighthouse', area: 'N1' }),
            wireCreate({ id: 'N5', type: 'faction', name: 'The Salt Rats' }),
            wireCreate({ id: 'N6', type: 'npc', name: 'Grisel' }),
          ],
        }),
    },
  ],
  contradiction: [
    {
      questions: ['Is Mara in her twenties or nearly ninety?'],
      records: () => wire(),
    },
  ],
  'session-recap': [
    {
      records: (ref) =>
        wire({
          creates: [
            wireCreate({
              id: 'N1',
              type: 'session_notes',
              name: 'Session 7',
              fields: [field('sessionNumber', '7')],
            }),
          ],
          updates: [update(ref('Mara Quill'), [field('status', 'dead')])],
        }),
    },
  ],
  'stat-block': [
    {
      records: () =>
        wire({
          creates: [
            wireCreate({
              id: 'N1',
              type: 'npc',
              name: 'Ashford Bog Troll',
              fields: [
                field('gmNotes', 'AC 15, HP 84 (8d10+40). Bite +7 to hit, 2d10+4 piercing.'),
              ],
            }),
          ],
        }),
    },
  ],
  'one-liner': [
    {
      questions: ['Is Tovin the master smith or an apprentice?'],
      records: () => wire({ creates: [wireCreate({ id: 'N1', type: 'npc', name: 'Tovin' })] }),
    },
  ],
  nickname: [
    {
      questions: ['Is Captain Varn taking bribes?'],
      records: (ref) =>
        wire({
          updates: [update(ref('Captain Ilsa Varn'), [field('secrets', 'Takes bribes.')])],
        }),
    },
  ],
  'make-it-up': [
    {
      records: (ref) =>
        wire({
          creates: [
            wireCreate({
              id: 'N1',
              type: 'spot',
              name: 'The Hearth and Hound',
              area: ref('Ashford'),
              fields: [field('readAloud', 'Warm light spills from round windows.')],
            }),
            wireCreate({
              id: 'N2',
              type: 'npc',
              name: 'Bettany Crook',
              fields: [field('appearance', 'Round, rosy, flour on her apron.')],
            }),
          ],
        }),
    },
  ],
  rename: [
    {
      questions: ['Is the inn by the town gate the Lamplighter Inn?'],
      records: (ref) =>
        wire({
          updates: [update(ref('The Lamplighter Inn'), [field('name', 'The Gilded Lamp')])],
        }),
    },
  ],
  props: [
    {
      records: (ref) =>
        wire({
          creates: [
            wireCreate({ id: 'N1', type: 'spot', name: 'Market Square', area: ref('Ashford') }),
            wireCreate({
              id: 'N2',
              type: 'prop',
              name: 'Old well',
              fields: [field('publicDescription', 'Its bucket rope has been cut clean through.')],
            }),
            wireCreate({
              id: 'N3',
              type: 'prop',
              name: 'Statue of Aldric Moss',
              fields: [
                field('publicDescription', 'The founder of Ashford, green with age.'),
                field('hiddenDetails', 'A brass key is hidden under its base.'),
              ],
            }),
            wireCreate({ id: 'N4', type: 'prop', name: 'Notice board' }),
            wireCreate({
              id: 'N5',
              type: 'prop',
              name: 'Forge bellows',
              fields: [field('hiddenDetails', 'Carved with old union marks.')],
            }),
            wireCreate({
              id: 'N6',
              type: 'item',
              name: 'Brass lantern',
              fields: [field('effect', 'Never runs out of oil.')],
            }),
          ],
          links: [
            { from: 'N2', to: 'N1', field: 'spot', label: '' },
            { from: 'N3', to: 'N1', field: 'spot', label: '' },
            // Written from the Spot's side; the validator turns it around (D-41).
            { from: 'N1', to: 'N4', field: 'propsHere', label: '' },
            { from: 'N5', to: ref('The Black Anvil'), field: 'spot', label: '' },
            { from: 'N1', to: 'N6', field: 'itemsHere', label: '' },
          ],
        }),
    },
    {
      records: (ref) =>
        wire({
          updates: [
            update(ref('Old well'), [
              field(
                'hiddenDetails',
                'A wedding ring was dropped down it last spring; its owner still comes to stare into it.',
              ),
            ]),
          ],
        }),
    },
  ],
  'type-filter': [
    {
      records: () =>
        wire({ creates: [wireCreate({ id: 'N1', type: 'npc', name: 'Old Juniper' })] }),
    },
  ],
};

/** A model that gives each case's scripted answers, step by step. */
function scripted(steps: Answers[], records?: (wireOut: ImportWireOutput) => ImportWireOutput) {
  let recordsCalls = 0;
  const calls: ImportCallInput[] = [];
  const settings: RunSettings = {
    apiKey: 'sk-ant-eval-test',
    systemPrompt: 'SYSTEM',
    model: MODEL,
    provider: {
      generateImport(input: ImportCallInput): Promise<ImportCallResult> {
        calls.push(input);
        const asking = input.user.step.includes('phase: questions');
        const answers = steps[asking ? recordsCalls : recordsCalls++];
        if (answers === undefined) throw new Error('no scripted answer for this step');
        const out = asking
          ? wire({ questions: answers.questions ?? [] })
          : answers.records((name) => refIn(input.user.prefix, name));
        return Promise.resolve({
          status: 'ok',
          text: JSON.stringify(asking || records === undefined ? out : records(out)),
          model: MODEL,
          usage: USAGE,
          turn: { content: [] },
        });
      },
    },
  };
  return { settings, calls };
}

describe('the eval grader', () => {
  it.each(EVAL_CASES.map((evalCase) => [evalCase.id, evalCase] as const))(
    'passes a perfect answer to %s',
    async (_id, evalCase) => {
      const steps = ORACLE[evalCase.id];
      if (steps === undefined) throw new Error(`no oracle for ${evalCase.id}`);
      const { settings } = scripted(steps);

      const runs = await runCase(evalCase, settings);

      for (const run of runs) {
        expect(run.status, run.error ?? '').toBe('ok');
        expect(run.grade?.failures).toEqual([]);
        expect(run.grade?.pass).toBe(true);
      }
      expect(runs).toHaveLength(evalCase.steps.length);
    },
  );

  it('fails every step when the model proposes nothing and asks nothing', async () => {
    let passed = 0;
    let steps = 0;
    for (const evalCase of EVAL_CASES) {
      const empty = evalCase.steps.map(() => ({ records: () => wire() }));
      const runs = await runCase(evalCase, scripted(empty).settings);
      steps += runs.length;
      passed += runs.filter((run) => run.grade?.pass === true).length;
    }
    expect(steps).toBe(15);
    expect(passed).toBe(0);
  });

  it('answers the questions with the scripted reply, then sends it to the records call', async () => {
    const marsh = EVAL_CASES.find((evalCase) => evalCase.id === 'marsh');
    const steps = ORACLE['marsh'];
    if (marsh === undefined || steps === undefined) throw new Error('fixture');
    const { settings, calls } = scripted(steps);

    const [first] = await runCase(marsh, settings);

    expect(first?.questions).toEqual([
      'The notes call the Keeper both she and he. Which is right?',
    ]);
    expect(first?.answer).toContain('use she and her');
    expect(calls[1]?.user.step).toContain('use she and her');
    expect(first?.usage.inputTokens).toBe(2000);
    expect(first?.costUsd).toBeGreaterThan(0);
  });

  it('catches a leaked secret, made-up numbers and a duplicate', async () => {
    const evalCase = EVAL_CASES.find((c) => c.id === 'rambling-city');
    const nickname = EVAL_CASES.find((c) => c.id === 'nickname');
    const steps = ORACLE['rambling-city'];
    if (evalCase === undefined || nickname === undefined || steps === undefined) {
      throw new Error('fixture');
    }
    const leaky = scripted(steps, (out) => ({
      ...out,
      creates: out.creates.map((create) =>
        create.name === 'The Copper Kettle'
          ? {
              ...create,
              fields: [
                field('publicDescription', 'A bathhouse that fronts a gambling den.'),
                field('readAloud', 'Make a DC 15 check to notice the dice.'),
              ],
            }
          : create,
      ),
    }));

    const [run] = await runCase(evalCase, leaky.settings);

    expect(run?.grade?.checks).toMatchObject({ secretsKept: false, noMechanics: false });
    expect(run?.grade?.failures.join('\n')).toContain('"DC 15" outside GM notes');

    const twice = scripted([
      { records: () => wire({ creates: [wireCreate({ id: 'N1', type: 'npc', name: 'Varn' })] }) },
    ]);
    const [dup] = await runCase(nickname, twice.settings);
    expect(dup?.grade?.checks.noDuplicates).toBe(false);
    expect(dup?.grade?.failures.join('\n')).toContain('repeats "Captain Ilsa Varn"');
  });

  it('reports a key or network failure as an error, not a fail', async () => {
    const terse = EVAL_CASES.find((c) => c.id === 'terse-npc');
    if (terse === undefined) throw new Error('fixture');
    const settings: RunSettings = {
      ...scripted([]).settings,
      provider: { generateImport: () => Promise.resolve({ status: 'unreachable' }) },
    };

    const [run] = await runCase(terse, settings);

    expect(run).toMatchObject({ status: 'error', error: 'unreachable', grade: null });
  });

  it('flags an answer from a model other than the one asked for', async () => {
    const terse = EVAL_CASES.find((c) => c.id === 'terse-npc');
    const steps = ORACLE['terse-npc'];
    if (terse === undefined || steps === undefined) throw new Error('fixture');
    const { settings } = scripted(steps);

    const [run] = await runCase(terse, { ...settings, model: 'claude-opus-5-5' });

    expect(run?.status).toBe('error');
    expect(run?.error).toContain('not claude-opus-5-5');
  });
});

describe('sameThing', () => {
  it('matches a name, its surname, and "the"', () => {
    expect(sameThing('Captain Ilsa Varn', 'Varn')).toBe(true);
    expect(sameThing('The Keeper', 'keeper')).toBe(true);
    expect(sameThing('Old Wick', 'Wick Acolyte')).toBe(false);
    expect(sameThing('Ashford', 'Ash')).toBe(false);
  });

  it('keeps places apart unless the names are the same', () => {
    expect(sameThing('Ashford', 'Road out of Ashford', 'area')).toBe(false);
    expect(sameThing('The Gull Market', 'gull market', 'spot')).toBe(true);
  });
});
