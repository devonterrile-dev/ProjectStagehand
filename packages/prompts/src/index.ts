/**
 * Versioned AI prompts (F1.9, governance §10): `<task>/v<N>.md`, read from disk.
 *
 * A released version is never edited: a change to a prompt is a new file and a bumped
 * version constant, so every import can say exactly which prompt produced it. A leading
 * `<!-- … -->` block in a file is a note for people and is not sent to the model. `{{slot}}`
 * markers are filled by the caller with text generated from the schemas, so the prompt and
 * the schemas can't drift apart.
 *
 * The files are not bundled into the server build. In dev and tests they are read from this
 * package; the production image copies them next to the bundle and points `PROMPTS_DIR` at
 * them, and the server loads its prompt at startup so a wrong path stops it there.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PROMPT_TASKS = ['import'] as const;
export type PromptTask = (typeof PROMPT_TASKS)[number];

/** The import prompt the server uses. Recorded on every import (`ai_imports.prompt_version`). */
export const IMPORT_PROMPT_VERSION = 4;

/** This package's folder: where the prompt files are when running from source. */
export const DEFAULT_PROMPTS_DIR = fileURLToPath(new URL('..', import.meta.url));

export class PromptError extends Error {
  override name = 'PromptError';
}

export function promptPath(task: PromptTask, version: number, dir = DEFAULT_PROMPTS_DIR): string {
  return join(dir, task, `v${String(version)}.md`);
}

const LEADING_COMMENT = /^\s*<!--[\s\S]*?-->\s*/;

/**
 * A prompt file's text as sent: line endings normalised, the leading `<!-- … -->` note for
 * people removed, trimmed. Also used by the image style bible (`@stagehand/style-bible`).
 */
export function stripLeadingNote(raw: string): string {
  return raw.replace(/\r\n/g, '\n').replace(LEADING_COMMENT, '').trim();
}

/** The text of one prompt version, without its leading note. Throws PromptError if missing. */
export function loadPrompt(task: PromptTask, version: number, dir = DEFAULT_PROMPTS_DIR): string {
  const path = promptPath(task, version, dir);
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    throw new PromptError(`Prompt file not found: ${path}`);
  }
  const text = stripLeadingNote(raw);
  if (text === '') throw new PromptError(`Prompt file is empty: ${path}`);
  return text;
}

const SLOT = /\{\{([a-z0-9_]+)\}\}/g;

/** The names of the `{{slot}}` markers in a template, once each, in order. */
export function slotsOf(template: string): string[] {
  return [...new Set([...template.matchAll(SLOT)].map((match) => match[1] ?? ''))];
}

/**
 * Fills every `{{slot}}`. A slot with no value, or a value with no slot, is an error: either
 * means the prompt file and the code that feeds it have drifted apart.
 */
export function fillPrompt(template: string, values: Readonly<Record<string, string>>): string {
  const slots = slotsOf(template);
  const missing = slots.filter((slot) => values[slot] === undefined);
  if (missing.length > 0) {
    throw new PromptError(`No value for prompt slot(s): ${missing.join(', ')}`);
  }
  const unused = Object.keys(values).filter((key) => !slots.includes(key));
  if (unused.length > 0) {
    throw new PromptError(`Prompt has no slot for: ${unused.join(', ')}`);
  }
  return template.replace(SLOT, (_marker, slot: string) => values[slot] ?? '');
}
