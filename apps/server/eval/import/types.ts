/**
 * The shape of an AI import eval case (F1.9b, D-32). A case is one or more import steps run
 * in order against a pretend campaign: each step's proposals are all accepted before the
 * next step runs, so a chain (start a campaign, add to it, fill in a record) behaves like a
 * GM working through it. Every step first runs the questions phase, answers with the
 * scripted `answer`, then writes the records (D-30).
 */
import type { ImportMode, RecordType } from '@stagehand/shared';

/** A record the campaign already holds before the case runs. Text is Markdown. */
export interface EvalRecord {
  /** A handle for `area` and `links` in the same case. */
  key: string;
  type: RecordType;
  name: string;
  /** Spots: the key of their Area. */
  area?: string;
  tags?: string[];
  publicDescription?: string;
  gmNotes?: string;
  /** Plain values as stored; rich text fields as Markdown strings. */
  fields?: Record<string, unknown>;
  /** Link fields of this record, to other records by key. */
  links?: { field: string; to: string }[];
}

/** A record the step must propose. */
export interface ExpectedCreate {
  type: RecordType;
  /** The name must match. Omit to accept any name. */
  name?: RegExp;
  /** The name must not match, e.g. a generic name where a made-up one was asked for. */
  notName?: RegExp;
  /** These fields must have a value. */
  fields?: string[];
}

export interface Expectations {
  /** Records that must be proposed. */
  creates?: ExpectedCreate[];
  /** At most `max` new records of `type` whose names match: catches one thing made twice. */
  atMost?: { type?: RecordType; name: RegExp; max: number }[];
  /** New records of `type` may only have names matching: catches invented characters. */
  onlyNamed?: { type: RecordType; names: RegExp }[];
  /** Existing records (by name) that must receive an update. */
  updates?: RegExp[];
  /** A field an update must set: the record, the field key, and a matching value. */
  updateValues?: { record: RegExp; field: string; value: RegExp }[];
  /** Words that must not appear in any players' description (`publicDescription`). */
  secrets?: RegExp[];
  /** The questions round: how many, and words at least one question must contain. */
  questions?: { min?: number; max?: number; about?: RegExp };
  /** Fill mode: fields that must be filled in, and words the values must contain. */
  fills?: { field: string; contains?: RegExp }[];
}

export interface EvalStep {
  mode: ImportMode;
  notes: string;
  targetTypes?: RecordType[];
  /** Fill mode: the record to complete, found by name in the campaign at that point. */
  fillTarget?: RegExp;
  /** The scripted reply to the questions round; null goes on to the records unanswered. */
  answer: string | null;
  expect: Expectations;
}

export interface EvalCase {
  id: string;
  title: string;
  /** What kind of notes this is, for the report. */
  style: string;
  /** The campaign before the first step. Empty for a bootstrap. */
  campaign?: EvalRecord[];
  steps: EvalStep[];
}
