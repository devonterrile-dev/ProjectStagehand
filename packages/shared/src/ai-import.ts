/**
 * AI note import (F1.8 and F1.9, governance §10, D-27): the GM's brain-dump goes to the model
 * with what the campaign already holds, and comes back as proposals the GM reviews before
 * anything is saved.
 *
 * Two shapes live here:
 *
 * - The **wire schema** (`importWireSchema`) is what the model must produce. Anthropic's
 *   structured output refuses recursive schemas and allows few optional or union-typed
 *   properties, so it is flat and type-agnostic: rich text travels as Markdown strings, a
 *   record's fields as `{ key, value }` pairs, and records are named by short ids (`E1` for an
 *   existing record, `N1` for a new one). Every property is required; an empty string or list
 *   means "nothing".
 * - The **proposal payloads** are what the server stores after validating that output against
 *   the real per-type schemas: record-shaped, rich text as TipTap JSON, real UUIDs. The review
 *   screen edits these.
 */
import { z } from 'zod';

import { fieldsSchemaFor, RECORD_TYPES, recordTypeSchema, type RecordType } from './record-fields';
import {
  linkFieldSpec,
  linkLabelSchema,
  linksPatchSchemaFor,
  otherLinksSchema,
} from './record-links';
import { recordNameSchema, tagSchema, tagsSchema } from './records';
import { recordRichTextSchema } from './rich-text';

/**
 * - `bootstrap`: the campaign is empty; nothing is sent besides the GM's text.
 * - `add`: new material for a campaign that already has records.
 * - `fill`: complete one existing record's empty fields.
 */
export const IMPORT_MODES = ['bootstrap', 'add', 'fill'] as const;
export const importModeSchema = z.enum(IMPORT_MODES);
export type ImportMode = z.infer<typeof importModeSchema>;

/**
 * - `running`: the model call is in flight.
 * - `ready`: proposals are waiting for review.
 * - `failed`: nothing usable came back; `error` says why.
 * - `committed`: the accepted proposals were saved.
 * - `discarded`: the GM dropped the import without saving.
 */
export const IMPORT_STATUSES = ['running', 'ready', 'failed', 'committed', 'discarded'] as const;
export const importStatusSchema = z.enum(IMPORT_STATUSES);
export type ImportStatus = z.infer<typeof importStatusSchema>;

export const PROPOSAL_ACTIONS = ['create', 'update', 'link'] as const;
export const proposalActionSchema = z.enum(PROPOSAL_ACTIONS);
export type ProposalAction = z.infer<typeof proposalActionSchema>;

/** `edited` counts as accepted: the GM changed the proposal, then kept it. */
export const PROPOSAL_REVIEW_STATES = ['pending', 'accepted', 'edited', 'rejected'] as const;
export const proposalReviewStateSchema = z.enum(PROPOSAL_REVIEW_STATES);
export type ProposalReviewState = z.infer<typeof proposalReviewStateSchema>;

/** The one text model for now, pinned (D-10). Every import records the model that answered. */
export const AI_IMPORT_MODEL = 'claude-sonnet-5-5';

/** USD per million tokens. Check against Anthropic's pricing page before relying on them. */
export interface ModelPrice {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

/**
 * Prices used for the cost estimates shown to the GM (§10 cost guardrails). A model that
 * isn't listed has no estimate rather than a wrong one.
 */
export const AI_MODEL_PRICES: Readonly<Record<string, ModelPrice>> = {
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 },
  // What Anthropic's refusal fallback may answer with instead.
  'claude-sonnet-5': { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
};

/** Guardrails for one import (§10, §14). Sizes are characters unless they say tokens. */
export const AI_IMPORT_LIMITS = {
  /** Longest brain-dump accepted. */
  inputMaxChars: 40_000,
  /** How much of the campaign's existing records may be sent along. */
  contextMaxChars: 80_000,
  /** Ceiling on the model's answer, in tokens. */
  maxOutputTokens: 32_000,
  /** Imports one GM may start per hour, across their campaigns. */
  importsPerHour: 20,
  /** Most new records one import may propose. */
  createsMax: 80,
  /** Most questions the model may ask back. */
  questionsMax: 20,
  /** Longest question kept. */
  questionMaxChars: 500,
} as const;

/** Token counts of one model call, as Anthropic reports them. */
export const tokenUsageSchema = z.object({
  inputTokens: z.int().min(0),
  outputTokens: z.int().min(0),
  cacheReadTokens: z.int().min(0),
  cacheWriteTokens: z.int().min(0),
});
export type TokenUsage = z.infer<typeof tokenUsageSchema>;

export function emptyTokenUsage(): TokenUsage {
  return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
}

export function addTokenUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
  };
}

/** What a call cost in USD at the listed prices, or null when the model has no listed price. */
export function estimateCostUsd(model: string, usage: TokenUsage): number | null {
  const price = AI_MODEL_PRICES[model];
  if (price === undefined) return null;
  return (
    (usage.inputTokens * price.input +
      usage.outputTokens * price.output +
      usage.cacheReadTokens * price.cacheRead +
      usage.cacheWriteTokens * price.cacheWrite) /
    1_000_000
  );
}

// ---------------------------------------------------------------------------
// Wire schema: what the model writes.
// ---------------------------------------------------------------------------

/** Fields every record type has, written like type fields in the wire format. */
export const WIRE_COMMON_FIELD_KEYS = ['publicDescription', 'gmNotes'] as const;
/** Only an update may carry this key: a new name for an existing record. */
export const WIRE_NAME_KEY = 'name';

const wireFieldSchema = z.object({
  key: z
    .string()
    .describe('A field key of the record type, exactly as listed in the field reference.'),
  value: z
    .string()
    .describe('The field value. Markdown for rich text fields, plain text otherwise.'),
});

const wirePointOfInterestSchema = z.object({
  name: z.string().describe('Short name of the point of interest.'),
  detail: z.string().describe('What the party finds or learns there. Plain text.'),
});

const wireCreateSchema = z.object({
  id: z.string().describe('A temporary id for this new record: N1, N2, N3…'),
  type: recordTypeSchema,
  name: z.string().describe('The record name.'),
  area: z
    .string()
    .describe('Spots only: the id of the Area the spot belongs to (E… or N…). Empty otherwise.'),
  tags: z.array(z.string()).describe('Short free tags. May be empty.'),
  fields: z
    .array(wireFieldSchema)
    .describe('Only the fields the notes give content for. Leave out anything unknown.'),
  pointsOfInterest: z
    .array(wirePointOfInterestSchema)
    .describe('Spots only: things the party can examine. Empty otherwise.'),
});

const wireUpdateSchema = z.object({
  id: z.string().describe('The id of an existing record that was shown in full (E…).'),
  fields: z
    .array(wireFieldSchema)
    .describe('Only the fields to change, each with its complete new value.'),
  addTags: z.array(z.string()).describe('Tags to add. May be empty.'),
  pointsOfInterest: z
    .array(wirePointOfInterestSchema)
    .describe('Spots only: the complete new list, or empty to leave the list as it is.'),
});

const wireLinkSchema = z.object({
  from: z.string().describe('The id of the record the link belongs to (E… or N…).'),
  to: z.string().describe('The id of the record it points at (E… or N…).'),
  field: z
    .string()
    .describe("A link field key of the from-record's type, or empty for a free-form link."),
  label: z
    .string()
    .describe('Free-form links only: a short relationship such as "rival of". Empty otherwise.'),
});

/** The model's whole answer (governance §10, "Proposal schema"). */
export const importWireSchema = z.object({
  creates: z.array(wireCreateSchema).describe('New records.'),
  updates: z.array(wireUpdateSchema).describe('Changes to existing records.'),
  links: z.array(wireLinkSchema).describe('Links between records, new or existing.'),
  questions: z
    .array(z.string())
    .describe('Short questions for the GM about things the notes leave undecided.'),
});
export type ImportWireOutput = z.infer<typeof importWireSchema>;
export type ImportWireCreate = ImportWireOutput['creates'][number];
export type ImportWireUpdate = ImportWireOutput['updates'][number];
export type ImportWireLink = ImportWireOutput['links'][number];

// ---------------------------------------------------------------------------
// Proposal payloads: what the server stores and the review screen edits.
// ---------------------------------------------------------------------------

/** Reports the issues of `schema` on `value` under `path`. */
function checkWith(
  ctx: z.RefinementCtx,
  schema: z.ZodType,
  value: unknown,
  path: PropertyKey[],
): void {
  const parsed = schema.safeParse(value);
  if (parsed.success) return;
  for (const issue of parsed.error.issues) {
    ctx.addIssue({ code: 'custom', message: issue.message, path: [...path, ...issue.path] });
  }
}

/**
 * A proposed new record. `id` is the record's future id, assigned when the proposal is made,
 * so other proposals of the same import can already link to and mention it. `links` holds
 * the type's link fields as record ids; any of them may name another proposed record.
 */
export const createProposalPayloadSchema = z
  .strictObject({
    id: z.uuid(),
    type: recordTypeSchema,
    name: recordNameSchema,
    /** The Area of a Spot: an existing Area, or one proposed in the same import. */
    parentId: z.uuid().nullable(),
    tags: tagsSchema,
    publicDescription: recordRichTextSchema,
    gmNotes: recordRichTextSchema,
    fields: z.record(z.string(), z.unknown()),
    links: z.record(z.string(), z.array(z.string())),
    otherLinks: otherLinksSchema,
  })
  .superRefine((payload, ctx) => {
    checkWith(ctx, fieldsSchemaFor(payload.type), payload.fields, ['fields']);
    checkWith(ctx, linksPatchSchemaFor(payload.type), payload.links, ['links']);
    if ((payload.type === 'spot') !== (payload.parentId !== null)) {
      ctx.addIssue({
        code: 'custom',
        path: ['parentId'],
        message: payload.type === 'spot' ? 'A spot needs an area' : 'Only spots have an area',
      });
    }
  });
export type CreateProposalPayload = z.infer<typeof createProposalPayloadSchema>;

/**
 * A proposed change to an existing record: only the keys present change, each to its whole
 * new value. Nothing is ever cleared or deleted (§10). `type` is the record's type when the
 * proposal was made, so `fields` can be checked without reading the record.
 */
export const updateProposalPayloadSchema = z
  .strictObject({
    recordId: z.uuid(),
    type: recordTypeSchema,
    name: recordNameSchema.optional(),
    publicDescription: recordRichTextSchema.optional(),
    gmNotes: recordRichTextSchema.optional(),
    /** Tags to add to the ones the record has. */
    addTags: z.array(tagSchema).optional(),
    fields: z.record(z.string(), z.unknown()).optional(),
  })
  .superRefine((payload, ctx) => {
    if (payload.fields !== undefined) {
      checkWith(ctx, fieldsSchemaFor(payload.type), payload.fields, ['fields']);
    }
    const changes =
      (payload.name === undefined ? 0 : 1) +
      (payload.publicDescription === undefined ? 0 : 1) +
      (payload.gmNotes === undefined ? 0 : 1) +
      (payload.addTags?.length ?? 0) +
      Object.keys(payload.fields ?? {}).length;
    if (changes === 0) ctx.addIssue({ code: 'custom', message: 'Nothing to update' });
  });
export type UpdateProposalPayload = z.infer<typeof updateProposalPayloadSchema>;

/**
 * A proposed link from an existing record. With a `fieldKey` it fills one of that record's
 * link fields (added to a `many` field, replacing a `one` field); without, it is a free-form
 * link with an optional relationship label. Links from a proposed record travel inside its
 * create proposal instead.
 */
export const linkProposalPayloadSchema = z
  .strictObject({
    fromId: z.uuid(),
    fromType: recordTypeSchema,
    toId: z.uuid(),
    fieldKey: z.string().nullable(),
    label: linkLabelSchema.nullable(),
  })
  .superRefine((payload, ctx) => {
    if (payload.fromId === payload.toId) {
      ctx.addIssue({ code: 'custom', message: "A record can't link to itself" });
    }
    if (payload.fieldKey === null) return;
    if (linkFieldSpec(payload.fromType, payload.fieldKey) === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['fieldKey'],
        message: `Unknown link field ${payload.fieldKey}`,
      });
    }
    if (payload.label !== null) {
      ctx.addIssue({
        code: 'custom',
        path: ['label'],
        message: 'Only free-form links have a relationship',
      });
    }
  });
export type LinkProposalPayload = z.infer<typeof linkProposalPayloadSchema>;

/** One proposal as the validator produces it, before it has a row of its own. */
export type ImportProposalDraft =
  | { action: 'create'; payload: CreateProposalPayload }
  | { action: 'update'; payload: UpdateProposalPayload }
  | { action: 'link'; payload: LinkProposalPayload };

/** The payload schema of each action. */
export const proposalPayloadSchemas = {
  create: createProposalPayloadSchema,
  update: updateProposalPayloadSchema,
  link: linkProposalPayloadSchema,
} satisfies Record<ProposalAction, z.ZodType>;

// ---------------------------------------------------------------------------
// Starting an import.
// ---------------------------------------------------------------------------

const uniqueTypes = (types: readonly RecordType[]) => new Set(types).size === types.length;

/**
 * `POST /api/campaigns/:campaignId/imports` (and `…/imports/estimate`). GM only.
 * - `text`: the brain-dump. Required except in `fill` mode, where it is optional guidance.
 * - `targetTypes`: when given, only these record types may be created ("only NPCs").
 * - `recordId`: the record to fill in; required in `fill` mode and refused otherwise.
 */
export const startImportRequestSchema = z
  .strictObject({
    mode: importModeSchema,
    text: z
      .string()
      .trim()
      .max(
        AI_IMPORT_LIMITS.inputMaxChars,
        `Notes must be ${String(AI_IMPORT_LIMITS.inputMaxChars)} characters or fewer. Split them into several imports.`,
      ),
    targetTypes: z
      .array(recordTypeSchema)
      .min(1, 'Pick at least one record type, or leave the filter off')
      .max(RECORD_TYPES.length)
      .refine(uniqueTypes, 'Each record type can only be picked once')
      .optional(),
    recordId: z.uuid().optional(),
  })
  .superRefine((request, ctx) => {
    if (request.mode === 'fill') {
      if (request.recordId === undefined) {
        ctx.addIssue({ code: 'custom', path: ['recordId'], message: 'Pick the record to fill in' });
      }
      if (request.targetTypes !== undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['targetTypes'],
          message: 'Filling in a record creates nothing, so it has no type filter',
        });
      }
      return;
    }
    if (request.recordId !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['recordId'],
        message: 'Only filling in a record names one',
      });
    }
    if (request.text === '') {
      ctx.addIssue({ code: 'custom', path: ['text'], message: 'Write some notes to import' });
    }
  });
export type StartImportRequest = z.infer<typeof startImportRequestSchema>;
