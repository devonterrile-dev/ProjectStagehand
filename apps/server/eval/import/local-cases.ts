/**
 * The GM's own notes as eval cases (F1.9b): every folder in the git-ignored `local/` with a
 * `scenario.json`. They run like the committed cases but never leave this machine.
 *
 * `scenario.json`: `{ "title", "style", "steps": [{ "mode", "notesFile", "answer",
 * "fillTarget"?, "targetTypes"?, "expect" }] }`. Patterns in `expect` (and `fillTarget`) are
 * strings, read as case-insensitive regular expressions.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ImportMode, RecordType } from '@stagehand/shared';

import type { EvalCase, Expectations } from './types';

export const LOCAL_DIR = fileURLToPath(new URL('./local/', import.meta.url));

/** Keys of `expect` whose values (or array items) are patterns. */
const PATTERN_KEYS = new Set(['name', 'notName', 'names', 'record', 'value', 'contains', 'about']);
const PATTERN_LISTS = new Set(['secrets', 'updates']);

function patterns(value: unknown, key = ''): unknown {
  if (typeof value === 'string' && PATTERN_KEYS.has(key)) return new RegExp(value, 'i');
  if (Array.isArray(value)) {
    return value.map((item) =>
      PATTERN_LISTS.has(key) && typeof item === 'string' ? new RegExp(item, 'i') : patterns(item),
    );
  }
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, patterns(v, k)]));
  }
  return value;
}

interface ScenarioFile {
  title: string;
  style: string;
  steps: {
    mode: ImportMode;
    notesFile: string;
    answer: string | null;
    fillTarget?: string;
    targetTypes?: RecordType[];
    expect?: Record<string, unknown>;
  }[];
}

export function loadLocalCases(): EvalCase[] {
  const root = LOCAL_DIR;
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(root, entry.name, 'scenario.json')))
    .map((entry) => {
      const dir = join(root, entry.name);
      const scenario = JSON.parse(readFileSync(join(dir, 'scenario.json'), 'utf8')) as ScenarioFile;
      return {
        id: `local-${entry.name}`,
        title: scenario.title,
        style: scenario.style,
        steps: scenario.steps.map((step) => ({
          mode: step.mode,
          notes: readFileSync(join(dir, step.notesFile), 'utf8').trim(),
          answer: step.answer,
          ...(step.targetTypes === undefined ? {} : { targetTypes: step.targetTypes }),
          ...(step.fillTarget === undefined
            ? {}
            : { fillTarget: new RegExp(step.fillTarget, 'i') }),
          expect: patterns(step.expect ?? {}) as Expectations,
        })),
      };
    });
}
