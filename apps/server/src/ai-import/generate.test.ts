import type { ImportWireOutput } from '@stagehand/shared';
import { describe, expect, it } from 'vitest';

import { harborPack, idMaker, IDS, newId, wire, wireCreate } from '../../test/import-fixtures';
import type { ImportCallInput, ImportCallResult } from '../providers/anthropic';

import { generateImport, type GenerateInput } from './generate';
import { userMessageText } from './prompt';

const USAGE = { inputTokens: 1000, outputTokens: 200, cacheReadTokens: 50, cacheWriteTokens: 10 };

/** A provider that gives each queued answer in turn and remembers what it was asked. */
function fakeProvider(answers: (ImportCallResult | ImportWireOutput | string)[]) {
  const calls: ImportCallInput[] = [];
  return {
    calls,
    generateImport(input: ImportCallInput): Promise<ImportCallResult> {
      calls.push(input);
      const next = answers.shift();
      if (next === undefined) throw new Error('the fake provider ran out of answers');
      if (typeof next === 'object' && 'status' in next) return Promise.resolve(next);
      return Promise.resolve({
        status: 'ok',
        text: typeof next === 'string' ? next : JSON.stringify(next),
        model: 'claude-sonnet-5-5',
        usage: USAGE,
        turn: { content: [{ type: 'text', text: `turn ${String(calls.length)}` }] },
      });
    },
  };
}

function input(
  provider: ReturnType<typeof fakeProvider>,
  overrides: Partial<GenerateInput> = {},
): GenerateInput {
  return {
    provider,
    apiKey: 'sk-ant-api03-generate-test-key',
    systemPrompt: 'SYSTEM',
    mode: 'add',
    phase: 'records',
    text: 'Mira the dockhand joined the Harbor Watch.',
    targetTypes: null,
    pack: harborPack(),
    conversation: [],
    newId: idMaker(),
    ...overrides,
  };
}

const GOOD = wire({
  creates: [wireCreate({ id: 'N1', type: 'npc', name: 'Mira', tags: ['docks'] })],
  links: [{ from: 'N1', to: 'E4', field: 'factions', label: '' }],
  questions: ['Is Mira a full member?'],
});

/** The whole user message of the nth call. */
const sent = (provider: ReturnType<typeof fakeProvider>, n: number) => {
  const user = provider.calls[n]?.user;
  return user === undefined ? '' : userMessageText(user);
};

/** Links to a record that doesn't exist. */
const BAD = wire({
  creates: [wireCreate({ id: 'N1', type: 'npc', name: 'Mira' })],
  links: [{ from: 'N1', to: 'E99', field: 'factions', label: '' }],
});

describe('generateImport', () => {
  it('turns a good first answer into proposals', async () => {
    const provider = fakeProvider([GOOD]);

    const result = await generateImport(input(provider));

    expect(result).toMatchObject({
      ok: true,
      model: 'claude-sonnet-5-5',
      attempts: 1,
      usage: USAGE,
      questions: ['Is Mira a full member?'],
    });
    expect(result.ok && result.proposals).toMatchObject([
      {
        action: 'create',
        payload: { id: newId(1), name: 'Mira', links: { factions: [IDS.harborWatch] } },
      },
    ]);

    expect(provider.calls).toHaveLength(1);
    const [call] = provider.calls;
    expect(call?.system).toBe('SYSTEM');
    expect(call?.user.prefix).toContain('<campaign>');
    expect(call?.user.prefix).toContain('Mira the dockhand joined the Harbor Watch.');
    expect(call?.user.step).toContain('mode: add');
    expect(call?.user.step).toContain('phase: records');
    expect(call?.retry).toBeUndefined();
  });

  it('sends a bad answer back once with its problems, then accepts the fix', async () => {
    const provider = fakeProvider([BAD, GOOD]);

    const result = await generateImport(input(provider));

    expect(result).toMatchObject({
      ok: true,
      attempts: 2,
      usage: {
        inputTokens: 2000,
        outputTokens: 400,
        cacheReadTokens: 100,
        cacheWriteTokens: 20,
      },
    });
    expect(provider.calls).toHaveLength(2);
    const retry = provider.calls[1]?.retry;
    // The model gets its own turn back, and every problem.
    expect(retry?.previous).toEqual({ content: [{ type: 'text', text: 'turn 1' }] });
    expect(retry?.message).toContain('"E99" is neither an existing record');
    expect(retry?.message).toContain('Send the complete answer again');
    expect(provider.calls[1]?.user).toEqual(provider.calls[0]?.user);
  });

  it('gives up after a second bad answer, with the problems as they are', async () => {
    const provider = fakeProvider([BAD, BAD]);

    const result = await generateImport(input(provider));

    expect(result).toMatchObject({ ok: false, error: 'invalid_output', attempts: 2 });
    expect(!result.ok && result.details).toEqual([
      expect.stringContaining('"E99" is neither an existing record'),
    ]);
    expect(result.usage.inputTokens).toBe(2000);
    expect(provider.calls).toHaveLength(2);
  });

  it('treats an answer that is not the agreed JSON as a problem to send back', async () => {
    const provider = fakeProvider(['Sure! Here are your records:', { creates: 'none' } as never]);

    const result = await generateImport(input(provider));

    expect(provider.calls[1]?.retry?.message).toContain('The answer was not valid JSON.');
    expect(result).toMatchObject({ ok: false, error: 'invalid_output', attempts: 2 });
    expect(!result.ok && result.details.join('\n')).toContain('creates');
  });

  it.each([
    [{ status: 'refused', model: 'claude-sonnet-5-5', usage: USAGE }, 'refused', 1, []],
    [{ status: 'truncated', model: 'claude-sonnet-5-5', usage: USAGE }, 'truncated', 1, []],
    [{ status: 'rejected' }, 'key_rejected', 0, []],
    [{ status: 'forbidden' }, 'key_forbidden', 0, []],
    [{ status: 'rate_limited' }, 'rate_limited', 0, []],
    [{ status: 'unreachable' }, 'unreachable', 0, []],
    [{ status: 'aborted' }, 'interrupted', 0, []],
    [{ status: 'bad_request', message: 'Out of credit.' }, 'bad_request', 0, ['Out of credit.']],
  ] as const)('stops on %o without a second call', async (answer, error, attempts, details) => {
    const provider = fakeProvider([answer]);

    const result = await generateImport(input(provider));

    expect(result).toMatchObject({ ok: false, error, attempts, details });
    expect(result.usage.inputTokens).toBe(attempts * 1000);
    expect(provider.calls).toHaveLength(1);
  });

  it('keeps what the first attempt cost when the retry fails outright', async () => {
    const provider = fakeProvider([BAD, { status: 'unreachable' }]);

    const result = await generateImport(input(provider));

    expect(result).toMatchObject({ ok: false, error: 'unreachable', attempts: 1, usage: USAGE });
  });

  it('holds fill mode to its record', async () => {
    const pack = { ...harborPack(), fillTargetId: IDS.voss };
    const provider = fakeProvider([
      wire({ creates: [wireCreate({ id: 'N1', type: 'npc', name: 'Mira' })] }),
      wire({
        updates: [
          {
            id: 'E3',
            fields: [{ key: 'personality', value: 'Dour.' }],
            addTags: [],
          },
        ],
      }),
    ]);

    const result = await generateImport(input(provider, { mode: 'fill', text: '', pack }));

    expect(sent(provider, 0)).toContain('Record to fill in: E3.');
    expect(provider.calls[1]?.retry?.message).toContain('fill mode, which creates no records');
    expect(result.ok && result.proposals).toMatchObject([
      { action: 'update', payload: { recordId: IDS.voss } },
    ]);
  });

  it('reads a questions step for its questions only', async () => {
    const provider = fakeProvider([
      wire({
        creates: [wireCreate({ id: 'N1', type: 'npc', name: 'Mira' })],
        questions: ['  Is Mira   the same as Captain Voss? ', ''],
      }),
    ]);

    const result = await generateImport(
      input(provider, {
        phase: 'questions',
        conversation: [{ questions: ['Which watch?'], answer: 'The Harbor Watch.' }],
      }),
    );

    expect(result).toMatchObject({
      ok: true,
      attempts: 1,
      proposals: [],
      questions: ['Is Mira the same as Captain Voss?'],
    });
    expect(provider.calls[0]?.user.step).toContain('phase: questions');
    expect(provider.calls[0]?.user.step).toContain('The Harbor Watch.');
    // The conversation never touches the cacheable prefix.
    expect(provider.calls[0]?.user.prefix).not.toContain('The Harbor Watch.');
  });
});
