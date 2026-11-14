/**
 * Builds what is sent to the model for an import (F1.9, governance §10 step 3).
 *
 * - The **system prompt** is the versioned file from `@stagehand/prompts` with each type's
 *   field list filled in from `RECORD_FIELD_SPECS`, so the prompt can never name a field the
 *   schemas don't have. It is the same for every request, which lets Anthropic cache it.
 * - The **user message** carries what changes, in two parts: a `prefix` (the context pack and
 *   the GM's notes) that stays the same over an import's rounds of questions, so it can be
 *   cached too, and a `step` (the earlier questions and answers, and the task) after it.
 *
 * Everything here is pure text building; `providers/anthropic.ts` makes the call.
 */
import {
  inverseLinkFieldsOf,
  RECORD_TYPE_LABELS,
  RECORD_TYPES,
  type FieldSpec,
  type ImportMode,
  type ImportPhase,
  type ImportRound,
  type RecordType,
  type RichText,
} from '@stagehand/shared';
import { fillPrompt, IMPORT_PROMPT_VERSION, loadPrompt } from '@stagehand/prompts';

import {
  emptyKeysOf,
  fieldSpecsOf,
  indexPack,
  isEmptyValue,
  type ContextPack,
  type ContextRecord,
} from './context';
import { richTextToMarkdown, type MentionRef } from './markdown';

const KIND_LABELS: Record<Exclude<FieldSpec['kind'], 'links' | 'enum'>, string> = {
  text: 'plain text',
  rich: 'rich text',
  number: 'number',
  date: 'date',
};

/** "one Spot", "any number of NPCs or Factions". */
function linkTargets(spec: Extract<FieldSpec, { kind: 'links' }>): string {
  const types = spec.targets.map((type) => `\`${type}\``).join(' or ');
  return spec.cardinality === 'one'
    ? `one record of type ${types}`
    : `any number of ${types} records`;
}

/** One type's fields and link fields as the prompt lists them, in display order. */
export function fieldReference(type: RecordType): string {
  const fields: string[] = [];
  const links: string[] = [];
  for (const [key, spec] of Object.entries(fieldSpecsOf(type))) {
    if (spec.kind === 'links') {
      links.push(`- \`${key}\` (${linkTargets(spec)}): ${spec.label}`);
    } else if (spec.kind === 'enum') {
      fields.push(`- \`${key}\` (choice: ${(spec.options ?? []).join(', ')}): ${spec.label}`);
    } else {
      fields.push(`- \`${key}\` (${KIND_LABELS[spec.kind]}): ${spec.label}`);
    }
  }
  const parts = [`Fields:\n${fields.join('\n')}`];
  if (links.length > 0) {
    parts.push(
      `Link fields, for \`links\` entries from a record of this type:\n${links.join('\n')}`,
    );
  }
  return parts.join('\n\n');
}

/** The system prompt: the prompt file with every `{{fields_<type>}}` slot filled. */
export function buildSystemPrompt(template: string): string {
  return fillPrompt(
    template,
    Object.fromEntries(RECORD_TYPES.map((type) => [`fields_${type}`, fieldReference(type)])),
  );
}

/**
 * Reads the pinned import prompt and fills it. `promptsDir` is `PROMPTS_DIR`; unset, the
 * file comes from the `@stagehand/prompts` package. Throws PromptError when the file is
 * missing or doesn't match the record types, which the server treats as a startup failure.
 */
export function loadImportSystemPrompt(promptsDir?: string): string {
  return buildSystemPrompt(loadPrompt('import', IMPORT_PROMPT_VERSION, promptsDir));
}

/** Invisible, and enough to stop `</notes>` in embedded text from being a tag. */
const ZERO_WIDTH_SPACE = String.fromCharCode(0x200b);
const WRAPPER_TAGS =
  /<(\/?)(campaign|index|record|field|links|task|notes|conversation|round|questions|answer)\b/gi;

/**
 * Stops text we embed (the GM's notes, record contents) from closing or opening one of our
 * own tags, so a note that happens to contain `</notes>` can't be read as the end of the notes.
 */
function guard(text: string): string {
  return text.replace(WRAPPER_TAGS, `<${ZERO_WIDTH_SPACE}$1$2`);
}

const attribute = (value: string) => guard(value).replace(/"/g, "'").replace(/\s+/g, ' ');

function indexLine(record: ContextRecord, refOf: MentionRef): string {
  const area = record.parentId === null ? null : refOf(record.parentId);
  const place =
    record.placeId === undefined || record.placeId === null ? null : refOf(record.placeId);
  const line = `${record.ref} | ${record.type} | ${record.name.replace(/\s+/g, ' ')}`;
  if (area !== null) return guard(`${line} | in ${area}`);
  // A Prop says which Spot it is at, so the model doesn't propose it there again (D-41).
  return guard(place === null ? line : `${line} | at ${place}`);
}

function fieldBlock(key: string, value: string): string {
  return `<field key="${key}">\n${guard(value)}\n</field>`;
}

function valueText(spec: FieldSpec, value: unknown, refOf: MentionRef): string {
  if (spec.kind === 'rich') return richTextToMarkdown(value as RichText, refOf);
  return String(value);
}

function fullRecordBlock(record: ContextRecord, refOf: MentionRef): string {
  const full = record.full;
  if (full === null) return '';
  const lines: string[] = [];
  if (full.tags.length > 0) lines.push(`tags: ${guard(full.tags.join(', '))}`);
  if (record.parentId !== null) lines.push(`area: ${refOf(record.parentId) ?? 'unknown'}`);

  const publicDescription = richTextToMarkdown(full.publicDescription, refOf);
  if (publicDescription !== '') lines.push(fieldBlock('publicDescription', publicDescription));
  const linkLines: string[] = [];
  for (const [key, spec] of Object.entries(fieldSpecsOf(record.type))) {
    if (spec.kind === 'links') {
      const refs = (full.links[key] ?? []).flatMap((id) => refOf(id) ?? []);
      if (refs.length > 0) linkLines.push(`${key}: ${refs.join(', ')}`);
    } else if (!isEmptyValue(full.fields[key])) {
      lines.push(fieldBlock(key, valueText(spec, full.fields[key], refOf)));
    }
  }
  // Lists stored on other records, such as a Spot's Props (D-41).
  for (const [key] of inverseLinkFieldsOf(record.type)) {
    const refs = (full.inverseLinks?.[key] ?? []).flatMap((id) => refOf(id) ?? []);
    if (refs.length > 0) linkLines.push(`${key}: ${refs.join(', ')}`);
  }
  const gmNotes = richTextToMarkdown(full.gmNotes, refOf);
  if (gmNotes !== '') lines.push(fieldBlock('gmNotes', gmNotes));

  for (const link of full.otherLinks) {
    const ref = refOf(link.recordId);
    if (ref === null) continue;
    linkLines.push(
      link.label === null ? `(free-form) ${ref}` : `(free-form) ${ref}: ${guard(link.label)}`,
    );
  }
  if (linkLines.length > 0) lines.push(`<links>\n${linkLines.join('\n')}\n</links>`);

  return recordBlock(record, 'full', lines.join('\n'));
}

function recordBlock(record: ContextRecord, detail: 'full' | 'summary', body: string): string {
  const open = `<record id="${record.ref}" type="${record.type}" name="${attribute(record.name)}" detail="${detail}">`;
  return body === '' ? `${open}\n</record>` : `${open}\n${body}\n</record>`;
}

/**
 * A record as the campaign block shows it after the index: its summary or its full content.
 * Empty for a record that is in the index only. `context-pack.ts` sizes records with it.
 */
export function recordDetailBlock(record: ContextRecord, refOf: MentionRef): string {
  if (record.full !== null) return fullRecordBlock(record, refOf);
  return record.summary === null ? '' : recordBlock(record, 'summary', guard(record.summary));
}

/** One line of the index: ref, type, name, and a Spot's Area. */
export function recordIndexLine(record: ContextRecord, refOf: MentionRef): string {
  return indexLine(record, refOf);
}

/** The `<campaign>` part: the index of every record, then the summaries and full records. */
export function buildCampaignBlock(pack: ContextPack): string {
  if (pack.records.length === 0) {
    return '<campaign>\nThe campaign has no records yet.\n</campaign>';
  }
  const { byId } = indexPack(pack);
  const refOf: MentionRef = (id) => byId.get(id)?.ref ?? null;

  const parts = [
    `<index>\n${pack.records.map((record) => indexLine(record, refOf)).join('\n')}\n</index>`,
  ];
  // Full records last, so the ones the notes are about sit closest to the notes.
  for (const record of pack.records) {
    if (record.full === null && record.summary !== null) {
      parts.push(recordDetailBlock(record, refOf));
    }
  }
  for (const record of pack.records) {
    if (record.full !== null) parts.push(recordDetailBlock(record, refOf));
  }
  return `<campaign>\n${parts.join('\n')}\n</campaign>`;
}

export interface ImportPromptInput {
  mode: ImportMode;
  /** Which call this is (D-30): asking questions, or writing the records. */
  phase: ImportPhase;
  /** The GM's notes. May be empty in `fill` mode. */
  text: string;
  /** When set, only these record types may be created. */
  targetTypes: readonly RecordType[] | null;
  pack: ContextPack;
  /** Earlier rounds of questions and the GM's answers, oldest first. */
  conversation: readonly ImportRound[];
}

/** The user message in its two parts; see the file comment. */
export interface ImportUserMessage {
  prefix: string;
  step: string;
}

function taskBlock(input: ImportPromptInput): string {
  const lines = [`mode: ${input.mode}`, `phase: ${input.phase}`];
  lines.push(
    input.phase === 'questions'
      ? 'Return only questions, or none. Leave creates, updates and links empty.'
      : 'Write the records now.',
  );
  if (input.targetTypes !== null && input.targetTypes.length > 0) {
    const types = input.targetTypes
      .map((type) => `${type} (${RECORD_TYPE_LABELS[type]})`)
      .join(', ');
    lines.push(
      `Create only records of these types: ${types}. Anything else in the notes may still update or link existing records.`,
    );
  }
  if (input.mode === 'fill') {
    const target = input.pack.records.find((record) => record.id === input.pack.fillTargetId);
    if (target?.full === undefined || target.full === null) {
      throw new Error('buildUserMessage: fill mode needs its target record shown in full');
    }
    const empty = emptyKeysOf(target.type, target.full);
    lines.push(`Record to fill in: ${target.ref}.`);
    lines.push(
      empty.fields.length === 0
        ? 'It has no empty fields.'
        : `Its empty fields: ${empty.fields.join(', ')}.`,
    );
    if (empty.links.length > 0) lines.push(`Its empty link fields: ${empty.links.join(', ')}.`);
    lines.push('Change a field that already has content only if the notes ask for that change.');
  }
  return `<task>\n${lines.join('\n')}\n</task>`;
}

/** The earlier rounds of questions and answers, or nothing before the first round. */
function conversationBlock(conversation: readonly ImportRound[]): string | null {
  if (conversation.length === 0) return null;
  const rounds = conversation.map((round, index) => {
    const questions = round.questions.map((question) => `- ${guard(question)}`).join('\n');
    const answer =
      round.answer === null ? '(The GM did not answer these.)' : guard(round.answer.trim());
    return [
      `<round n="${String(index + 1)}">`,
      `<questions>\n${questions}\n</questions>`,
      `<answer>\n${answer}\n</answer>`,
      '</round>',
    ].join('\n');
  });
  return `<conversation>\n${rounds.join('\n')}\n</conversation>`;
}

/** The user message: campaign and notes (the cacheable prefix), then conversation and task. */
export function buildUserMessage(input: ImportPromptInput): ImportUserMessage {
  const notes =
    input.text.trim() === '' ? '(The GM gave no notes for this request.)' : guard(input.text);
  const step = [conversationBlock(input.conversation), taskBlock(input)].filter(
    (part): part is string => part !== null,
  );
  return {
    prefix: `${buildCampaignBlock(input.pack)}\n\n<notes>\n${notes}\n</notes>`,
    step: step.join('\n\n'),
  };
}

/** The whole user message as one text, as the model reads it. */
export function userMessageText(message: ImportUserMessage): string {
  return `${message.prefix}\n\n${message.step}`;
}

/**
 * What the model is told when its answer fails validation (§10 step 4): every problem, and to
 * send the whole answer again.
 */
export function buildRetryMessage(issues: readonly string[]): string {
  return [
    'Your answer could not be used as it is. These problems were found:',
    '',
    ...issues.map((issue) => `- ${issue}`),
    '',
    'Send the complete answer again with these fixed. Keep everything that was not at fault.',
  ].join('\n');
}
