/**
 * Runs eval cases through the real import pipeline (F1.9b): `generateImport`, the same
 * function the server's background job calls, with the same prompt and context pack. Each
 * step is a questions call, the scripted answer, then a records call (D-30), and its
 * proposals are applied before the next step of the case.
 */
import { randomUUID } from 'node:crypto';

import {
  addTokenUsage,
  emptyTokenUsage,
  estimateCostUsd,
  type ImportErrorCode,
  type ImportProposalDraft,
  type ImportRound,
  type TokenUsage,
} from '@stagehand/shared';

import { generateImport, type GenerateResult } from '../../src/ai-import/generate';
import type { AnthropicProvider } from '../../src/providers/anthropic';

import { EvalCampaign } from './campaign';
import { CHECKS, gradeStep, type Check, type StepGrade } from './grade';
import type { EvalCase, EvalStep } from './types';

export interface RunSettings {
  provider: Pick<AnthropicProvider, 'generateImport'>;
  apiKey: string;
  systemPrompt: string;
  /** The model asked for, to catch an answer from another one. */
  model: string;
}

/**
 * Failures that say nothing about the model's work (our key, our network, our bug). They
 * are reported as errors and left out of the scores, instead of counting as a fail.
 */
const HARNESS_ERRORS: ReadonlySet<ImportErrorCode> = new Set([
  'key_rejected',
  'key_forbidden',
  'rate_limited',
  'unreachable',
  'bad_request',
  'interrupted',
  'internal',
]);

export interface StepRun {
  caseId: string;
  step: number;
  mode: EvalStep['mode'];
  /** `error`: a harness failure, not graded. `skipped`: an earlier step of the case failed. */
  status: 'ok' | 'error' | 'skipped';
  error: string | null;
  /** The model that answered, when one did. */
  model: string | null;
  questions: string[];
  /** The scripted answer, when there were questions to answer. */
  answer: string | null;
  attempts: { questions: number; records: number };
  proposals: ImportProposalDraft[];
  grade: StepGrade | null;
  /** Both calls together. */
  usage: TokenUsage;
  costUsd: number | null;
  latencyMs: number;
}

const EMPTY_CHECKS = Object.fromEntries(CHECKS.map((check) => [check, null])) as Record<
  Check,
  boolean | null
>;

const failed = (result: GenerateResult) => (result.ok ? null : result.error);

/** Runs every step of one case in order. A step that fails stops the rest of its case. */
export async function runCase(evalCase: EvalCase, settings: RunSettings): Promise<StepRun[]> {
  const campaign = EvalCampaign.from(evalCase.campaign);
  const runs: StepRun[] = [];
  let stopped: string | null = null;

  for (const [index, step] of evalCase.steps.entries()) {
    const base = {
      caseId: evalCase.id,
      step: index + 1,
      mode: step.mode,
      questions: [],
      answer: null,
      attempts: { questions: 0, records: 0 },
      proposals: [],
      model: null,
      usage: emptyTokenUsage(),
      costUsd: null,
      latencyMs: 0,
    };
    if (stopped !== null) {
      runs.push({ ...base, status: 'skipped', error: stopped, grade: null });
      continue;
    }
    const run = await runStep(step, campaign, settings);
    runs.push({ ...base, ...run });
    if (run.status !== 'ok' || run.grade?.checks.valid !== true) {
      stopped = `step ${String(index + 1)} gave no usable answer`;
    }
  }
  return runs;
}

async function runStep(
  step: EvalStep,
  campaign: EvalCampaign,
  settings: RunSettings,
): Promise<Omit<StepRun, 'caseId' | 'step' | 'mode'>> {
  const started = Date.now();
  const existing = campaign.names();
  const target = step.fillTarget === undefined ? undefined : campaign.find(step.fillTarget);
  if (step.mode === 'fill' && target === undefined) {
    // An earlier step didn't make the record: this step fails without a call.
    return {
      status: 'ok',
      error: null,
      model: null,
      questions: [],
      answer: null,
      attempts: { questions: 0, records: 0 },
      proposals: [],
      grade: {
        pass: false,
        checks: { ...EMPTY_CHECKS, expected: false },
        failures: [`expected: no record matches the fill target ${String(step.fillTarget)}`],
      },
      usage: emptyTokenUsage(),
      costUsd: null,
      latencyMs: 0,
    };
  }
  const fillTargetId = target?.id ?? null;
  const call = (phase: 'questions' | 'records', text: string, conversation: ImportRound[]) =>
    generateImport({
      provider: settings.provider,
      apiKey: settings.apiKey,
      systemPrompt: settings.systemPrompt,
      mode: step.mode,
      phase,
      text: step.notes,
      targetTypes: step.targetTypes ?? null,
      // As in the app, the answers count towards which records go in full.
      pack: campaign.pack(step.mode, text, fillTargetId),
      conversation,
      newId: randomUUID,
    });

  const asked = await call('questions', step.notes, []);
  let usage = asked.usage;
  const done = (
    status: StepRun['status'],
    error: string | null,
    rest: Partial<StepRun> = {},
  ): Omit<StepRun, 'caseId' | 'step' | 'mode'> => ({
    status,
    error,
    model: asked.attempts > 0 ? asked.model : null,
    questions: [],
    answer: null,
    attempts: { questions: asked.attempts, records: 0 },
    proposals: [],
    grade: null,
    usage,
    costUsd: estimateCostUsd(asked.model, usage),
    latencyMs: Date.now() - started,
    ...rest,
  });

  const askError = failed(asked);
  if (askError !== null && HARNESS_ERRORS.has(askError)) return done('error', askError);
  const questions = asked.ok ? asked.questions : [];
  const answer = questions.length > 0 ? step.answer : null;
  const conversation = questions.length > 0 ? [{ questions, answer }] : [];

  const records =
    askError === null
      ? await call('records', [step.notes, answer ?? ''].join('\n\n'), conversation)
      : null;
  if (records !== null) usage = addTokenUsage(usage, records.usage);
  const recordsError = records === null ? askError : failed(records);
  if (recordsError !== null && HARNESS_ERRORS.has(recordsError)) {
    return done('error', recordsError, { questions, answer });
  }

  const model = records?.attempts ? records.model : asked.model;
  if (!model.startsWith(settings.model)) {
    return done('error', `answered by ${model}, not ${settings.model}`, { questions, answer });
  }
  const proposals = records?.ok === true ? records.proposals : null;
  const grade = gradeStep({
    expect: step.expect,
    notes: step.notes,
    answer,
    existing,
    fillTargetId,
    questions,
    proposals,
  });
  if (proposals !== null) campaign.apply(proposals);
  return done('ok', recordsError, {
    model,
    questions,
    answer,
    attempts: { questions: asked.attempts, records: records?.attempts ?? 0 },
    proposals: proposals ?? [],
    grade,
    costUsd: estimateCostUsd(model, usage),
  });
}
