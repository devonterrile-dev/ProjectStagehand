/**
 * One import from notes to proposals (governance §10 steps 3 and 4, D-27): ask the model,
 * check the answer, send it back once with its problems if it has any, and give up with
 * those problems if the second answer has some too.
 *
 * No database and no HTTP in here: the routes hand in a context pack and store what comes
 * back, and the eval suite (F1.9b) calls this same function, so it measures the pipeline GMs
 * actually use.
 */
import {
  addTokenUsage,
  AI_IMPORT_MODEL,
  emptyTokenUsage,
  importWireSchema,
  type ImportErrorCode,
  type ImportMode,
  type ImportProposalDraft,
  type RecordType,
  type TokenUsage,
} from '@stagehand/shared';

import type { AnthropicProvider, ImportCallResult, ImportTurn } from '../providers/anthropic';

import type { ContextPack } from './context';
import { buildRetryMessage, buildUserMessage } from './prompt';
import { validateImportOutput } from './validate';

export interface GenerateInput {
  provider: Pick<AnthropicProvider, 'generateImport'>;
  apiKey: string;
  /** The filled prompt file (`loadImportSystemPrompt`). */
  systemPrompt: string;
  mode: ImportMode;
  text: string;
  targetTypes: readonly RecordType[] | null;
  pack: ContextPack;
  /** Makes the id of each proposed record (a UUID). */
  newId: () => string;
  signal?: AbortSignal;
}

interface GenerateStats {
  /** The model that answered last; the pinned one if none did. */
  model: string;
  /** Tokens over every attempt. */
  usage: TokenUsage;
  /** Model calls that returned: 0 to 2. */
  attempts: number;
}

export type GenerateResult = GenerateStats &
  (
    | { ok: true; proposals: ImportProposalDraft[]; questions: string[] }
    | { ok: false; error: ImportErrorCode; details: string[] }
  );

/** The import error a failed call stands for. */
const CALL_ERRORS: Record<Exclude<ImportCallResult['status'], 'ok'>, ImportErrorCode> = {
  refused: 'refused',
  truncated: 'truncated',
  rejected: 'key_rejected',
  forbidden: 'key_forbidden',
  rate_limited: 'rate_limited',
  unreachable: 'unreachable',
  bad_request: 'bad_request',
  aborted: 'interrupted',
};

type Checked =
  | { ok: true; proposals: ImportProposalDraft[]; questions: string[] }
  | { ok: false; issues: string[] };

/** Parses and validates one answer. Problems are worded for the model. */
function check(text: string, input: GenerateInput): Checked {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, issues: ['The answer was not valid JSON.'] };
  }
  const wire = importWireSchema.safeParse(json);
  if (!wire.success) {
    return {
      ok: false,
      issues: wire.error.issues.map(
        (issue) => `${issue.path.join('.') || 'answer'}: ${issue.message}`,
      ),
    };
  }
  return validateImportOutput({
    output: wire.data,
    mode: input.mode,
    targetTypes: input.targetTypes,
    pack: input.pack,
    newId: input.newId,
  });
}

export async function generateImport(input: GenerateInput): Promise<GenerateResult> {
  const user = buildUserMessage({
    mode: input.mode,
    text: input.text,
    targetTypes: input.targetTypes,
    pack: input.pack,
  });
  const stats: GenerateStats = { model: AI_IMPORT_MODEL, usage: emptyTokenUsage(), attempts: 0 };
  let retry: { previous: ImportTurn; message: string } | undefined;
  let issues: string[] = [];

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const call = await input.provider.generateImport({
      apiKey: input.apiKey,
      system: input.systemPrompt,
      user,
      ...(retry === undefined ? {} : { retry }),
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    });
    if (call.status !== 'ok') {
      if ('usage' in call) {
        stats.attempts = attempt;
        stats.model = call.model;
        stats.usage = addTokenUsage(stats.usage, call.usage);
      }
      const details = call.status === 'bad_request' ? [call.message] : [];
      return { ...stats, ok: false, error: CALL_ERRORS[call.status], details };
    }
    stats.attempts = attempt;
    stats.model = call.model;
    stats.usage = addTokenUsage(stats.usage, call.usage);

    const checked = check(call.text, input);
    if (checked.ok) return { ...stats, ...checked };
    issues = checked.issues;
    retry = { previous: call.turn, message: buildRetryMessage(issues) };
  }
  return { ...stats, ok: false, error: 'invalid_output', details: issues };
}
