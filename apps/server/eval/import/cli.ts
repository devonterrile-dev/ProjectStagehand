/**
 * `pnpm eval`: runs the AI import eval (F1.9b, D-32) against the real Anthropic API, with the
 * key in `ANTHROPIC_API_KEY` (git-ignored `apps/server/.env`). It costs real tokens, so it
 * runs by hand, never in CI. Start with `--dry-run`, which only counts tokens (free) and
 * quotes a cost.
 *
 *   pnpm eval --dry-run                 quote the cost of a full run
 *   pnpm eval                           every case, medium and high effort, 2 runs each
 *   pnpm eval --effort medium --reps 1  a cheaper pass
 *   pnpm eval --only marsh,one-liner    some cases
 *   pnpm eval --local                   also the GM's own notes in eval/import/local/
 *   pnpm eval --model <id>              another model, e.g. a replacement for a retired one
 *   pnpm eval --resume <results dir>    finish a run that stopped
 *
 * Results go to the git-ignored `eval/results/<time>/`: `results.jsonl` (one row per step),
 * `traces/` (every proposal, for reading) and `summary.md`. The key is never printed.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import {
  AI_IMPORT_MODEL,
  emptyTokenUsage,
  estimateCostUsd,
  estimateImportCostUsd,
} from '@stagehand/shared';

import { IMPORT_PROMPT_VERSION } from '@stagehand/prompts';

import { buildUserMessage, loadImportSystemPrompt } from '../../src/ai-import/prompt';
import { createAnthropicProvider, type ImportEffort } from '../../src/providers/anthropic';

import { EvalCampaign } from './campaign';
import { EVAL_CASES } from './cases';
import { CHECKS } from './grade';
import { loadLocalCases } from './local-cases';
import { runCase, type StepRun } from './run';
import type { EvalCase } from './types';

const RESULTS_DIR = fileURLToPath(new URL('../results/', import.meta.url));
/** Output a questions call is guessed to need (thinking included), for the dry-run quote. */
const QUESTIONS_OUTPUT_GUESS = 1500;

const { values } = parseArgs({
  options: {
    'dry-run': { type: 'boolean', default: false },
    effort: { type: 'string', default: 'medium,high' },
    reps: { type: 'string', default: '2' },
    only: { type: 'string' },
    local: { type: 'boolean', default: false },
    model: { type: 'string', default: AI_IMPORT_MODEL },
    concurrency: { type: 'string', default: '3' },
    resume: { type: 'string' },
  },
});

const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
const efforts = values.effort.split(',').map((effort) => effort.trim());
for (const effort of efforts) {
  if (!(EFFORTS as readonly string[]).includes(effort)) {
    throw new Error(`Unknown effort "${effort}". Use ${EFFORTS.join(', ')}.`);
  }
}
const reps = Number(values.reps);
const concurrency = Math.max(1, Number(values.concurrency));
const model = values.model;
const only = values.only?.split(',').map((id) => id.trim());

let cases: EvalCase[] = [...EVAL_CASES, ...(values.local ? loadLocalCases() : [])];
if (only !== undefined) cases = cases.filter((evalCase) => only.includes(evalCase.id));
if (cases.length === 0) throw new Error('No eval cases to run.');

const apiKey = process.env['ANTHROPIC_API_KEY'] ?? '';
if (apiKey === '') {
  throw new Error('Set ANTHROPIC_API_KEY in apps/server/.env to run the eval.');
}
const systemPrompt = loadImportSystemPrompt();
const usd = (value: number | null) => (value === null ? 'n/a' : `$${value.toFixed(2)}`);

// ---------------------------------------------------------------------------
// --dry-run: count the input tokens (free) and quote what a run would cost.
// ---------------------------------------------------------------------------

async function quote(): Promise<void> {
  const provider = createAnthropicProvider({ model });
  let perRun = 0;
  let unpriced = false;
  for (const evalCase of cases) {
    const campaign = EvalCampaign.from(evalCase.campaign);
    let firstInput = 0;
    for (const [index, step] of evalCase.steps.entries()) {
      let input: number;
      if (index === 0) {
        const pack = campaign.pack(step.mode, step.notes, null);
        const message = (phase: 'questions' | 'records') =>
          buildUserMessage({
            mode: step.mode,
            phase,
            text: step.notes,
            targetTypes: step.targetTypes ?? null,
            pack,
            conversation: [],
          });
        const count = await provider.countImportTokens({
          apiKey,
          system: systemPrompt,
          user: message('records'),
        });
        if (count.status !== 'ok') throw new Error(`Token count failed: ${count.status}`);
        input = count.inputTokens;
        firstInput = input;
      } else {
        // Later steps of a chain see the records the earlier ones made: guessed, not counted.
        input = Math.round(firstInput * 1.5 + step.notes.length / 3.5);
      }
      const questions = estimateCostUsd(model, {
        ...emptyTokenUsage(),
        inputTokens: input,
        outputTokens: QUESTIONS_OUTPUT_GUESS,
      });
      const records = estimateImportCostUsd(model, input, step.notes.length)?.likely ?? null;
      if (questions === null || records === null) unpriced = true;
      else perRun += questions + records;
      console.log(
        `${evalCase.id} step ${String(index + 1)}: ~${String(input)} tokens in${index === 0 ? '' : ' (guessed)'}`,
      );
    }
  }
  const runs = efforts.length * reps;
  console.log('');
  if (unpriced) {
    console.log(`No price is listed for ${model}, so there is no cost estimate.`);
    return;
  }
  console.log(
    `One pass over ${String(cases.length)} cases: about ${usd(perRun)} at medium effort.`,
  );
  console.log(
    `This run (${efforts.join(' + ')} effort, ${String(reps)} each): about ${usd(perRun * runs)}, up to ${usd(perRun * runs * 1.6)} if high effort thinks much longer.`,
  );
  console.log('Nothing was spent: token counting is free.');
}

// ---------------------------------------------------------------------------
// A run.
// ---------------------------------------------------------------------------

interface Row extends StepRun {
  effort: string;
  rep: number;
}

const keyOf = (caseId: string, effort: string, rep: number) => `${caseId}|${effort}|${String(rep)}`;

async function run(): Promise<void> {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const dir = values.resume ?? join(RESULTS_DIR, stamp);
  mkdirSync(join(dir, 'traces'), { recursive: true });
  const resultsFile = join(dir, 'results.jsonl');
  const done = new Map<string, Row[]>();
  if (existsSync(resultsFile)) {
    for (const line of readFileSync(resultsFile, 'utf8').split('\n')) {
      if (line.trim() === '') continue;
      const row = JSON.parse(line) as Row;
      const key = keyOf(row.caseId, row.effort, row.rep);
      done.set(key, [...(done.get(key) ?? []), row]);
    }
  }

  const jobs: { evalCase: EvalCase; effort: ImportEffort; rep: number }[] = [];
  for (const effort of efforts as ImportEffort[]) {
    for (let rep = 1; rep <= reps; rep += 1) {
      for (const evalCase of cases) {
        const previous = done.get(keyOf(evalCase.id, effort, rep));
        // A case is done when every step has a row and none was a harness error.
        const complete =
          previous?.length === evalCase.steps.length &&
          previous.every((row) => row.status !== 'error');
        if (!complete) jobs.push({ evalCase, effort, rep });
      }
    }
  }
  console.log(`Running ${String(jobs.length)} case runs into ${dir}`);

  const fresh = new Map<string, Row[]>();
  let next = 0;
  async function worker(): Promise<void> {
    while (next < jobs.length) {
      const job = jobs[next];
      next += 1;
      if (job === undefined) return;
      const provider = createAnthropicProvider({ model, effort: job.effort });
      const steps = await runCase(job.evalCase, { provider, apiKey, systemPrompt, model });
      const rows = steps.map((step) => ({ ...step, effort: job.effort, rep: job.rep }));
      fresh.set(keyOf(job.evalCase.id, job.effort, job.rep), rows);
      for (const row of rows) {
        appendFileSync(resultsFile, `${JSON.stringify(row)}\n`);
        writeFileSync(
          join(
            dir,
            'traces',
            `${row.caseId}_step${String(row.step)}_${row.effort}_${String(row.rep)}.json`,
          ),
          JSON.stringify(row, null, 2),
        );
        const verdict =
          row.status !== 'ok' ? row.status.toUpperCase() : row.grade?.pass ? 'pass' : 'FAIL';
        console.log(
          `${row.caseId} step ${String(row.step)} ${row.effort} #${String(row.rep)}: ${verdict} (${usd(row.costUsd)})${row.error === null ? '' : ` ${row.error}`}`,
        );
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, worker));

  const rows = [...new Map([...done, ...fresh]).values()].flat();
  const summary = summarise(rows);
  writeFileSync(join(dir, 'summary.md'), summary);
  console.log(`\n${summary}`);
}

/** The report: each effort's scores and cost, then every step that failed and why. */
function summarise(rows: Row[]): string {
  const lines = [
    `# AI import eval`,
    '',
    `Model ${model}, prompt v${String(IMPORT_PROMPT_VERSION)}, ${String(reps)} run(s) per effort.`,
    '',
  ];
  lines.push(`| Effort | Steps passed | ${CHECKS.join(' | ')} | Errors | Cost | Avg time |`);
  lines.push(`|${' --- |'.repeat(CHECKS.length + 5)}`);
  for (const effort of efforts) {
    const mine = rows.filter((row) => row.effort === effort);
    const graded = mine.filter((row) => row.status === 'ok' && row.grade !== null);
    const rate = (check: (typeof CHECKS)[number]) => {
      const ran = graded.filter((row) => row.grade?.checks[check] !== null);
      if (ran.length === 0) return '-';
      const passed = ran.filter((row) => row.grade?.checks[check] === true).length;
      return `${String(passed)}/${String(ran.length)}`;
    };
    const cost = mine.reduce((sum, row) => sum + (row.costUsd ?? 0), 0);
    const time = graded.reduce((sum, row) => sum + row.latencyMs, 0) / Math.max(1, graded.length);
    lines.push(
      `| ${effort} | ${String(graded.filter((row) => row.grade?.pass).length)}/${String(graded.length)} | ${CHECKS.map(rate).join(' | ')} | ${String(mine.filter((row) => row.status === 'error').length)} | ${usd(cost)} | ${(time / 1000).toFixed(0)} s |`,
    );
  }
  lines.push('', '## Steps that failed', '');
  const failures = rows.filter((row) => row.status !== 'ok' || row.grade?.pass !== true);
  if (failures.length === 0) lines.push('None.');
  for (const row of failures) {
    const why =
      row.status === 'ok'
        ? (row.grade?.failures ?? []).join('; ')
        : `${row.status}: ${row.error ?? ''}`;
    lines.push(
      `- **${row.caseId} step ${String(row.step)}** (${row.effort} #${String(row.rep)}): ${why}`,
    );
  }
  lines.push('', '## Questions asked', '');
  for (const row of rows.filter((r) => r.effort === efforts[0] && r.rep === 1)) {
    if (row.questions.length === 0) continue;
    lines.push(`- **${row.caseId} step ${String(row.step)}**: ${row.questions.join(' / ')}`);
  }
  return `${lines.join('\n')}\n`;
}

await (values['dry-run'] ? quote() : run());
