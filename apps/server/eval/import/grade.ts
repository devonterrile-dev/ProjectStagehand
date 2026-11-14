/**
 * Grades one eval step (F1.9b, D-32). Every check is code, not a model's opinion, so the
 * same answer always gets the same grade. A check is `null` when the step doesn't test it.
 *
 * - `valid`: the model's answer was usable (on the first try or after the one retry).
 * - `expected`: the records, updates and filled fields the case asks for are there.
 * - `noDuplicates`: no new record repeats an existing one, or another new one.
 * - `noInvented`: new records of a type are only the ones the notes name.
 * - `secretsKept`: no secret reaches a players' description.
 * - `noMechanics`: no dice, difficulty or hit point numbers outside GM notes, and in GM
 *   notes only ones the notes themselves had.
 * - `questions`: the questions round asked a sensible number, about the right thing.
 */
import {
  isEmptyRichText,
  richTextToPlainText,
  type CreateProposalPayload,
  type ImportProposalDraft,
  type RecordType,
  type RichText,
  type UpdateProposalPayload,
} from '@stagehand/shared';

import type { Expectations } from './types';

export const CHECKS = [
  'valid',
  'expected',
  'noDuplicates',
  'noInvented',
  'secretsKept',
  'noMechanics',
  'questions',
] as const;
export type Check = (typeof CHECKS)[number];

export interface StepGrade {
  /** Every check that ran passed. */
  pass: boolean;
  checks: Record<Check, boolean | null>;
  /** Why each failed check failed, for the report. */
  failures: string[];
}

export interface GradeInput {
  expect: Expectations;
  /** The GM's notes and scripted answer: game numbers from these may be kept. */
  notes: string;
  answer: string | null;
  /** The records the campaign held before the step. */
  existing: readonly { id: string; type: RecordType; name: string }[];
  /** Fill mode: the record being completed. */
  fillTargetId: string | null;
  /** What the questions round asked. */
  questions: readonly string[];
  /** The records step's proposals, or null when it gave no usable answer. */
  proposals: readonly ImportProposalDraft[] | null;
}

/** The most questions any round may ask unless the case says otherwise. */
export const QUESTIONS_MAX = 8;

/** Game statistics: dice, difficulty classes, armour class, hit points, attack bonuses. */
const MECHANICS: readonly RegExp[] = [
  /\b\d*d(4|6|8|10|12|20|100)\b/gi,
  /\bDC\s*\d+/gi,
  /\b(AC|HP)\s*\d+/gi,
  /\b\d+\s*(HP|hit points?)\b/gi,
  /[+-]\d+\s*to hit\b/gi,
  /\b(STR|DEX|CON|INT|WIS|CHA)\s+\d+/g,
];

const squash = (text: string) => text.toLowerCase().replace(/\s+/g, ' ');

function valueText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map((item: unknown) => valueText(item)).join('\n');
  if (typeof value === 'object' && value !== null && 'type' in value) {
    return richTextToPlainText(value as RichText);
  }
  return '';
}

function isBlank(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object' && 'type' in value) return isEmptyRichText(value as RichText);
  return false;
}

/** The texts of a proposal, split into what players may see, GM notes, and the rest. */
function textsOf(payload: CreateProposalPayload | UpdateProposalPayload) {
  return {
    public:
      payload.publicDescription === undefined ? '' : richTextToPlainText(payload.publicDescription),
    gmNotes: payload.gmNotes === undefined ? '' : richTextToPlainText(payload.gmNotes),
    other: [
      'name' in payload && payload.name !== undefined ? payload.name : '',
      ...Object.values(payload.fields ?? {}).map(valueText),
    ].join('\n'),
  };
}

/** A name for comparing: lower case, without "the" and punctuation. */
function normal(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/^\s*the\s+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Types whose short and long names mean the same thing (`Varn` and `Captain Ilsa Varn`). A
 * place inside a longer name is usually another place (`Ashford`, `Road out of Ashford`).
 */
const NICKNAMED: ReadonlySet<RecordType> = new Set(['npc', 'faction', 'item']);

/**
 * The same name; for people, groups and things, also one name inside the other as whole
 * words (`Varn` in `Captain Ilsa Varn`).
 */
export function sameThing(a: string, b: string, type: RecordType = 'npc'): boolean {
  const [x, y] = [normal(a), normal(b)];
  if (x === y) return true;
  if (!NICKNAMED.has(type)) return false;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return short.length >= 4 && ` ${long} `.includes(` ${short} `);
}

export function gradeStep(input: GradeInput): StepGrade {
  const failures: string[] = [];
  const checks: Record<Check, boolean | null> = {
    valid: null,
    expected: null,
    noDuplicates: null,
    noInvented: null,
    secretsKept: null,
    noMechanics: null,
    questions: null,
  };
  const fail = (check: Check, why: string) => {
    checks[check] = false;
    failures.push(`${check}: ${why}`);
  };
  const { expect } = input;

  // The questions round is graded even when the records step failed.
  checks.questions = true;
  const max = expect.questions?.max ?? QUESTIONS_MAX;
  const asked = input.questions.length;
  if (asked > max) fail('questions', `asked ${String(asked)}, at most ${String(max)} expected`);
  if (expect.questions?.min !== undefined && asked < expect.questions.min) {
    fail('questions', `asked ${String(asked)}, at least ${String(expect.questions.min)} expected`);
  }
  const about = expect.questions?.about;
  if (about !== undefined && asked > 0 && !input.questions.some((q) => about.test(q))) {
    fail('questions', `no question matched ${String(about)}`);
  }

  if (input.proposals === null) {
    fail('valid', 'no usable answer');
    return { pass: false, checks, failures };
  }
  checks.valid = true;

  const creates = input.proposals.flatMap((p) => (p.action === 'create' ? [p.payload] : []));
  const updates = input.proposals.flatMap((p) => (p.action === 'update' ? [p.payload] : []));
  const nameOf = new Map([
    ...input.existing.map((record) => [record.id, record.name] as const),
    ...creates.map((create) => [create.id, create.name] as const),
  ]);
  /** Whether a new record's link field holds a record whose name matches (F1.10). */
  const linksTo = (create: (typeof creates)[number], want: { field: string; to: RegExp }) =>
    (create.links[want.field] ?? []).some((id) => want.to.test(nameOf.get(id) ?? ''));
  const updated = (name: RegExp) =>
    updates.filter((update) => name.test(nameOf.get(update.recordId) ?? ''));

  // What the case asks for.
  const wanted =
    (expect.creates?.length ?? 0) +
    (expect.updates?.length ?? 0) +
    (expect.renames?.length ?? 0) +
    (expect.updateValues?.length ?? 0) +
    (expect.fills?.length ?? 0);
  if (wanted > 0) {
    checks.expected = true;
    for (const want of expect.creates ?? []) {
      const found = creates.find(
        (create) =>
          create.type === want.type &&
          (want.name === undefined || want.name.test(create.name)) &&
          !(want.notName?.test(create.name) ?? false) &&
          (want.fields ?? []).every((key) => !isBlank(create.fields[key])) &&
          (want.linkedTo === undefined || linksTo(create, want.linkedTo)),
      );
      if (found === undefined) {
        const what = [
          want.name === undefined ? 'any name' : String(want.name),
          want.notName === undefined ? '' : `not ${String(want.notName)}`,
          want.fields === undefined ? '' : `with ${want.fields.join(', ')}`,
          want.linkedTo === undefined ? '' : `${want.linkedTo.field} → ${String(want.linkedTo.to)}`,
        ].filter((part) => part !== '');
        fail('expected', `no new ${want.type} (${what.join(', ')})`);
      }
    }
    for (const name of expect.updates ?? []) {
      if (updated(name).length === 0) fail('expected', `no update to ${String(name)}`);
    }
    for (const want of expect.renames ?? []) {
      if (!updated(want.record).some((update) => want.to.test(update.name ?? ''))) {
        fail('expected', `${String(want.record)} was not renamed to ${String(want.to)}`);
      }
    }
    for (const want of expect.updateValues ?? []) {
      const hit = updated(want.record).some((update) =>
        want.value.test(valueText(update.fields?.[want.field])),
      );
      if (!hit) {
        fail(
          'expected',
          `no update setting ${want.field} ${String(want.value)} on ${String(want.record)}`,
        );
      }
    }
    for (const want of expect.fills ?? []) {
      const value = updates.find((update) => update.recordId === input.fillTargetId)?.fields?.[
        want.field
      ];
      if (isBlank(value)) fail('expected', `${want.field} was not filled in`);
      else if (want.contains !== undefined && !want.contains.test(valueText(value))) {
        fail('expected', `${want.field} doesn't match ${String(want.contains)}`);
      }
    }
  }

  // Nothing made twice.
  checks.noDuplicates = true;
  for (const create of creates) {
    const twin = input.existing.find(
      (record) => record.type === create.type && sameThing(record.name, create.name, create.type),
    );
    if (twin !== undefined) {
      fail('noDuplicates', `new ${create.type} "${create.name}" repeats "${twin.name}"`);
    }
  }
  creates.forEach((create, index) => {
    const twin = creates
      .slice(index + 1)
      .find(
        (other) => other.type === create.type && sameThing(other.name, create.name, create.type),
      );
    if (twin !== undefined) {
      fail('noDuplicates', `"${create.name}" and "${twin.name}" are both new ${create.type}s`);
    }
  });
  for (const limit of expect.atMost ?? []) {
    const matching = creates.filter(
      (create) =>
        (limit.type === undefined || create.type === limit.type) && limit.name.test(create.name),
    );
    if (matching.length > limit.max) {
      fail(
        'noDuplicates',
        `${String(matching.length)} new records match ${String(limit.name)} (at most ${String(limit.max)}): ${matching.map((c) => c.name).join(', ')}`,
      );
    }
  }

  // Nothing invented.
  if (expect.onlyNamed !== undefined) {
    checks.noInvented = true;
    for (const rule of expect.onlyNamed) {
      for (const create of creates) {
        if (create.type === rule.type && !rule.names.test(create.name)) {
          fail('noInvented', `new ${create.type} "${create.name}" isn't in the notes`);
        }
      }
    }
  }

  // Secrets stay out of what players see.
  const texts = [...creates, ...updates].map(textsOf);
  if (expect.secrets !== undefined) {
    checks.secretsKept = true;
    for (const secret of expect.secrets) {
      for (const text of texts) {
        if (secret.test(text.public)) {
          fail('secretsKept', `a players' description matches ${String(secret)}`);
          break;
        }
      }
    }
  }

  // No game mechanics beyond the ones the notes wrote down, and those only in GM notes.
  checks.noMechanics = true;
  const source = squash(`${input.notes}\n${input.answer ?? ''}`);
  for (const text of texts) {
    for (const pattern of MECHANICS) {
      for (const match of `${text.public}\n${text.other}`.matchAll(pattern)) {
        fail('noMechanics', `"${match[0]}" outside GM notes`);
      }
      for (const match of text.gmNotes.matchAll(pattern)) {
        if (!source.includes(squash(match[0]))) {
          fail('noMechanics', `"${match[0]}" in GM notes isn't from the notes`);
        }
      }
    }
  }

  const pass = Object.values(checks).every((value) => value !== false);
  return { pass, checks, failures };
}
