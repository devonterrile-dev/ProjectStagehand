/**
 * Checks the model's answer and turns it into proposals (F1.9, governance §10 step 4).
 *
 * The wire format is loose on purpose (see `ai-import.ts` in the shared package), so the real
 * rules are enforced here, against the same schemas the record API uses: field keys and
 * values per type, link targets and cardinality, ids that exist or are proposed in the same
 * answer, a Spot's Area, and updates only on records the model was shown in full.
 *
 * Anything the model could not have known better is fixed quietly (letter case of a choice,
 * blank values, a tag that is too long). Anything else becomes an issue, written for the
 * model: the caller sends the list back once, and a second failure goes to the GM as it is.
 *
 * Pure: no database, no clock. New records get their ids from `newId`.
 */
import {
  AI_IMPORT_LIMITS,
  createProposalPayloadSchema,
  emptyRichText,
  fieldsSchemaFor,
  LINK_LABEL_MAX,
  linkFieldsOf,
  linkFieldSpec,
  linkProposalPayloadSchema,
  OTHER_LINKS_MAX,
  RECORD_NAME_MAX,
  RECORD_TYPE_LABELS,
  recordRichTextSchema,
  TAG_MAX,
  TAGS_MAX,
  updateProposalPayloadSchema,
  WIRE_COMMON_FIELD_KEYS,
  WIRE_NAME_KEY,
  type CreateProposalPayload,
  type ImportMode,
  type ImportProposalDraft,
  type ImportWireOutput,
  type LinkProposalPayload,
  type RecordType,
  type RichText,
  type UpdateProposalPayload,
} from '@stagehand/shared';
import type { z } from 'zod';

import {
  fieldSpecsOf,
  indexPack,
  isEmptyValue,
  type ContextPack,
  type ContextRecord,
} from './context';
import {
  markdownToRichText,
  mentionsToNames,
  richTextToMarkdown,
  type MentionResolver,
} from './markdown';

export interface ValidationInput {
  output: ImportWireOutput;
  mode: ImportMode;
  /** When set, only these record types may be created. */
  targetTypes: readonly RecordType[] | null;
  pack: ContextPack;
  /** Makes the id of each proposed record (a UUID). */
  newId: () => string;
}

export type ValidationResult =
  | { ok: true; proposals: ImportProposalDraft[]; questions: string[] }
  | { ok: false; issues: string[] };

/** A record a ref can name: one the campaign has, or one this answer creates. */
interface Target {
  id: string;
  type: RecordType;
  name: string;
  existing: ContextRecord | null;
}

type CommonKey = (typeof WIRE_COMMON_FIELD_KEYS)[number];

interface ConvertedFields {
  name?: string;
  publicDescription?: RichText;
  gmNotes?: RichText;
  fields: Record<string, unknown>;
}

const NEW_REF = /^N\d+$/;
const squash = (key: string) => key.toLowerCase().replace(/[^a-z0-9]/g, '');
const quote = (text: string) => `"${text.replace(/\s+/g, ' ').slice(0, 80)}"`;

function zodIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) =>
    issue.path.length === 0 ? issue.message : `${issue.path.join('.')}: ${issue.message}`,
  );
}

/** Trimmed, unique, at most 20, each at most 40 characters; anything else is dropped. */
function cleanTags(tags: readonly string[], skip: readonly string[] = []): string[] {
  const seen = new Set(skip);
  const out: string[] = [];
  for (const raw of tags) {
    const tag = raw.trim();
    if (tag === '' || tag.length > TAG_MAX || seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
    if (out.length === TAGS_MAX) break;
  }
  return out;
}

export function validateImportOutput(input: ValidationInput): ValidationResult {
  const { output, mode, pack } = input;
  const issues: string[] = [];
  const { byRef, byId } = indexPack(pack);

  // --- Which records can be named -------------------------------------------------------

  const targets = new Map<string, Target>();
  for (const [ref, record] of byRef) {
    targets.set(ref, { id: record.id, type: record.type, name: record.name, existing: record });
  }
  const lookup = (ref: string): Target | null => targets.get(ref.trim().toUpperCase()) ?? null;
  const resolveMention: MentionResolver = (ref) => {
    const target = lookup(ref);
    return target === null ? null : { id: target.id, label: target.name };
  };

  if (output.creates.length > AI_IMPORT_LIMITS.createsMax) {
    issues.push(
      `creates: ${String(output.creates.length)} new records is more than one import may propose (${String(AI_IMPORT_LIMITS.createsMax)}). Keep the most important ones and say in a question that the rest need a second import.`,
    );
  }

  /** Each create's label for issues, and its payload once it has a usable id and name. */
  const creates = output.creates.map((create, index) => {
    const ref = create.id.trim().toUpperCase();
    const name = create.name.trim().replace(/\s+/g, ' ');
    const where = `creates[${String(index)}] ${quote(name)} (${ref === '' ? 'no id' : ref})`;
    let usable = true;

    if (!NEW_REF.test(ref)) {
      issues.push(`${where}: the id of a new record must look like N1, N2, …`);
      usable = false;
    } else if (targets.has(ref)) {
      issues.push(`${where}: the id ${ref} is used by more than one new record`);
      usable = false;
    }
    if (name === '' || name.length > RECORD_NAME_MAX) {
      issues.push(`${where}: a record name must be 1 to ${String(RECORD_NAME_MAX)} characters`);
      usable = false;
    }
    if (mode === 'fill') {
      issues.push(`${where}: this request is in fill mode, which creates no records`);
      usable = false;
    } else if (input.targetTypes !== null && !input.targetTypes.includes(create.type)) {
      issues.push(
        `${where}: the task allows new records only of type ${input.targetTypes.join(', ')}; this one is ${create.type}`,
      );
      usable = false;
    }
    if (!usable) return { where, wire: create, payload: null };

    const payload: CreateProposalPayload = {
      id: input.newId(),
      type: create.type,
      name,
      parentId: null,
      tags: cleanTags(create.tags),
      publicDescription: emptyRichText(),
      gmNotes: emptyRichText(),
      fields: {},
      links: {},
      otherLinks: [],
    };
    targets.set(ref, { id: payload.id, type: create.type, name, existing: null });
    return { where, wire: create, payload };
  });

  // --- Field values ---------------------------------------------------------------------

  /** Converts the wire fields of one record; problems go to `issues` under `where`. */
  function convertFields(
    type: RecordType,
    wireFields: ImportWireOutput['creates'][number]['fields'],
    points: ImportWireOutput['creates'][number]['pointsOfInterest'],
    where: string,
    allowName: boolean,
  ): ConvertedFields {
    const specs = fieldSpecsOf(type);
    const keysBySquash = new Map<string, string>([
      ...Object.keys(specs).map((key) => [squash(key), key] as const),
      ...WIRE_COMMON_FIELD_KEYS.map((key) => [squash(key), key] as const),
      [squash(WIRE_NAME_KEY), WIRE_NAME_KEY],
    ]);
    const converted: ConvertedFields = { fields: {} };

    const rich = (key: string, value: string): RichText | null => {
      const { doc, unknownMentions } = markdownToRichText(value, resolveMention);
      for (const ref of unknownMentions) {
        issues.push(
          `${where}: field ${key} mentions [[${ref}]], which is neither an existing record nor one created in this answer`,
        );
      }
      const parsed = recordRichTextSchema.safeParse(doc);
      if (!parsed.success) {
        issues.push(`${where}: field ${key}: ${zodIssues(parsed.error).join('; ')}`);
        return null;
      }
      return unknownMentions.length > 0 ? null : parsed.data;
    };

    for (const field of wireFields) {
      if (field.value.trim() === '') continue; // "empty values don't overwrite" (§10)
      const key = keysBySquash.get(squash(field.key));
      if (key === undefined) {
        const valid = [...WIRE_COMMON_FIELD_KEYS, ...Object.keys(specs)].join(', ');
        issues.push(
          `${where}: ${RECORD_TYPE_LABELS[type]} records have no field ${quote(field.key)}. Their fields are: ${valid}`,
        );
        continue;
      }
      if (key === WIRE_NAME_KEY) {
        // A create carries its name on its own; only an update may rename.
        if (allowName) converted.name = field.value.trim().replace(/\s+/g, ' ');
        continue;
      }
      if ((WIRE_COMMON_FIELD_KEYS as readonly string[]).includes(key)) {
        const doc = rich(key, field.value);
        if (doc !== null) converted[key as CommonKey] = doc;
        continue;
      }
      const spec = specs[key];
      switch (spec?.kind) {
        case undefined:
          break;
        case 'links':
          issues.push(
            `${where}: ${key} is a link field. Put it in links, as { from: this record, to: the other record, field: "${key}" }`,
          );
          break;
        case 'list':
          issues.push(`${where}: ${key} goes in the record's pointsOfInterest list, not in fields`);
          break;
        case 'rich': {
          const doc = rich(key, field.value);
          if (doc !== null) converted.fields[key] = doc;
          break;
        }
        case 'text':
          converted.fields[key] = mentionsToNames(field.value, resolveMention).trim();
          break;
        case 'enum': {
          const wanted = squash(field.value);
          const option = (spec.options ?? []).find((candidate) => squash(candidate) === wanted);
          if (option === undefined) {
            issues.push(
              `${where}: field ${key} must be one of ${(spec.options ?? []).join(', ')}, not ${quote(field.value)}`,
            );
          } else {
            converted.fields[key] = option;
          }
          break;
        }
        case 'number': {
          const digits = field.value.trim();
          if (/^\d{1,9}$/.test(digits)) converted.fields[key] = Number(digits);
          else
            issues.push(
              `${where}: field ${key} must be a whole number in digits, not ${quote(field.value)}`,
            );
          break;
        }
        case 'date':
          converted.fields[key] = field.value.trim();
          break;
      }
    }

    if (type === 'spot') {
      const list = points
        .map((point) => ({
          name: point.name.trim(),
          detail: mentionsToNames(point.detail, resolveMention).trim(),
        }))
        .filter((point) => point.name !== '');
      if (list.length > 0) converted.fields['pointsOfInterest'] = list;
    }

    const parsed = fieldsSchemaFor(type).safeParse(converted.fields);
    if (parsed.success) converted.fields = parsed.data;
    else for (const issue of zodIssues(parsed.error)) issues.push(`${where}: field ${issue}`);
    return converted;
  }

  for (const { where, wire, payload } of creates) {
    if (payload === null) continue;
    if (wire.type === 'spot') {
      const area = lookup(wire.area);
      if (area === null) {
        issues.push(
          `${where}: a spot must name its area. ${quote(wire.area)} is neither an existing record nor one created in this answer`,
        );
      } else if (area.type !== 'area') {
        issues.push(
          `${where}: a spot's area must be a record of type area, but ${wire.area.trim()} (${quote(area.name)}) is a ${area.type}`,
        );
      } else {
        payload.parentId = area.id;
      }
    }
    const converted = convertFields(wire.type, wire.fields, wire.pointsOfInterest, where, false);
    if (converted.publicDescription !== undefined)
      payload.publicDescription = converted.publicDescription;
    if (converted.gmNotes !== undefined) payload.gmNotes = converted.gmNotes;
    payload.fields = converted.fields;
  }

  // --- Updates --------------------------------------------------------------------------

  const updates: UpdateProposalPayload[] = [];
  const updatedRefs = new Set<string>();
  output.updates.forEach((update, index) => {
    const ref = update.id.trim().toUpperCase();
    const record = byRef.get(ref);
    const where = `updates[${String(index)}] (${ref === '' ? 'no id' : ref}${record === undefined ? '' : ` ${quote(record.name)}`})`;

    if (record === undefined) {
      issues.push(
        targets.has(ref)
          ? `${where}: ${ref} is created in this answer. Put its content in the create instead of updating it`
          : `${where}: there is no existing record ${quote(update.id)}`,
      );
      return;
    }
    if (record.full === null) {
      issues.push(
        `${where}: this record was not shown in full, so its fields can't be replaced. Link to it, or ask a question`,
      );
      return;
    }
    if (mode === 'fill' && record.id !== pack.fillTargetId) {
      issues.push(`${where}: fill mode changes only the record named in the task`);
      return;
    }
    if (updatedRefs.has(ref)) {
      issues.push(`${where}: ${ref} is updated more than once. Merge the changes into one update`);
      return;
    }
    updatedRefs.add(ref);

    const full = record.full;
    const converted = convertFields(
      record.type,
      update.fields,
      update.pointsOfInterest,
      where,
      true,
    );
    const payload: UpdateProposalPayload = { recordId: record.id, type: record.type };

    // A value that says what the record already says is no change. In fill mode a field
    // that already has content is left alone: that mode only fills gaps.
    const keepRich = (current: RichText, next: RichText | undefined): RichText | undefined => {
      if (next === undefined) return undefined;
      if (mode === 'fill' && !isEmptyValue(current)) return undefined;
      return richTextToMarkdown(current) === richTextToMarkdown(next) ? undefined : next;
    };
    const publicDescription = keepRich(full.publicDescription, converted.publicDescription);
    if (publicDescription !== undefined) payload.publicDescription = publicDescription;
    const gmNotes = keepRich(full.gmNotes, converted.gmNotes);
    if (gmNotes !== undefined) payload.gmNotes = gmNotes;

    if (converted.name !== undefined && mode !== 'fill' && converted.name !== record.name) {
      if (converted.name === '' || converted.name.length > RECORD_NAME_MAX) {
        issues.push(`${where}: a record name must be 1 to ${String(RECORD_NAME_MAX)} characters`);
      } else {
        payload.name = converted.name;
      }
    }

    const specs = fieldSpecsOf(record.type);
    const fields: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(converted.fields)) {
      const current = full.fields[key];
      if (mode === 'fill' && !isEmptyValue(current)) continue;
      const same =
        specs[key]?.kind === 'rich' && !isEmptyValue(current)
          ? richTextToMarkdown(current as RichText) === richTextToMarkdown(value as RichText)
          : JSON.stringify(current ?? null) === JSON.stringify(value);
      if (!same) fields[key] = value;
    }
    if (Object.keys(fields).length > 0) payload.fields = fields;

    const room = Math.max(0, TAGS_MAX - full.tags.length);
    const addTags = cleanTags(update.addTags, full.tags).slice(0, room);
    if (addTags.length > 0) payload.addTags = addTags;

    const parsed = updateProposalPayloadSchema.safeParse(payload);
    if (parsed.success) updates.push(parsed.data);
    // An update that changes nothing is simply dropped; any other failure is a real problem.
    else if (Object.keys(payload).length > 2) {
      for (const issue of zodIssues(parsed.error)) issues.push(`${where}: ${issue}`);
    }
  });

  // --- Links ----------------------------------------------------------------------------

  const payloadByNewId = new Map(
    creates.flatMap(({ payload }) => (payload === null ? [] : [[payload.id, payload] as const])),
  );
  const links: LinkProposalPayload[] = [];
  const linkKeys = new Set<string>();
  /** How many links a `one` field of an existing record got in this answer. */
  const oneFieldLinks = new Map<string, number>();

  output.links.forEach((link, index) => {
    const where = `links[${String(index)}] (${link.from.trim()} → ${link.to.trim()})`;
    const from = lookup(link.from);
    const to = lookup(link.to);
    if (from === null || to === null) {
      const missing = [from === null ? link.from : null, to === null ? link.to : null]
        .filter((ref) => ref !== null)
        .map(quote)
        .join(' and ');
      issues.push(
        `${where}: ${missing} is neither an existing record nor one created in this answer`,
      );
      return;
    }
    if (from.id === to.id) {
      issues.push(`${where}: a record can't link to itself`);
      return;
    }
    if (mode === 'fill' && from.id !== pack.fillTargetId) {
      issues.push(`${where}: fill mode adds links only from the record named in the task`);
      return;
    }

    const fieldName = link.field.trim();
    if (fieldName === '') {
      const label = link.label.trim().replace(/\s+/g, ' ').slice(0, LINK_LABEL_MAX).trim();
      const other = { recordId: to.id, label: label === '' ? null : label };
      const create = payloadByNewId.get(from.id);
      if (create !== undefined) {
        const taken = create.otherLinks.some((existing) => existing.recordId === to.id);
        if (!taken && create.otherLinks.length < OTHER_LINKS_MAX) create.otherLinks.push(other);
        return;
      }
      if (
        from.existing?.full?.otherLinks.some((existing) => existing.recordId === to.id) === true
      ) {
        return; // Already linked.
      }
      const key = `${from.id}>${to.id}>`;
      if (linkKeys.has(key)) return;
      linkKeys.add(key);
      links.push({
        fromId: from.id,
        fromType: from.type,
        toId: to.id,
        fieldKey: null,
        label: other.label,
      });
      return;
    }

    const fieldKey = linkFieldsOf(from.type).find(
      ([key]) => squash(key) === squash(fieldName),
    )?.[0];
    const spec = fieldKey === undefined ? undefined : linkFieldSpec(from.type, fieldKey);
    if (fieldKey === undefined || spec === undefined) {
      const valid = linkFieldsOf(from.type).map(([key]) => key);
      issues.push(
        `${where}: ${RECORD_TYPE_LABELS[from.type]} records have no link field ${quote(link.field)}. ` +
          (valid.length === 0
            ? 'They have no link fields at all: leave field empty and give a label.'
            : `Theirs are: ${valid.join(', ')}. The field must belong to the from-record's type; swap from and to if it belongs to the other record, or leave field empty and give a label.`),
      );
      return;
    }
    if (!spec.targets.includes(to.type)) {
      issues.push(
        `${where}: ${fieldKey} can only link records of type ${spec.targets.join(' or ')}, but ${link.to.trim()} (${quote(to.name)}) is a ${to.type}`,
      );
      return;
    }

    const create = payloadByNewId.get(from.id);
    if (create !== undefined) {
      const list = (create.links[fieldKey] ??= []);
      if (list.includes(to.id)) return;
      if (spec.cardinality === 'one' && list.length > 0) {
        issues.push(`${where}: ${fieldKey} holds one record, and this record already has one`);
        return;
      }
      list.push(to.id);
      return;
    }

    if (from.existing?.full?.links[fieldKey]?.includes(to.id) === true) return; // Already linked.
    const key = `${from.id}>${to.id}>${fieldKey}`;
    if (linkKeys.has(key)) return;
    if (spec.cardinality === 'one') {
      const slot = `${from.id}>${fieldKey}`;
      const count = (oneFieldLinks.get(slot) ?? 0) + 1;
      oneFieldLinks.set(slot, count);
      if (count > 1) {
        issues.push(
          `${where}: ${fieldKey} holds one record, and this answer gives it more than one`,
        );
        return;
      }
    }
    linkKeys.add(key);
    links.push({ fromId: from.id, fromType: from.type, toId: to.id, fieldKey, label: null });
  });

  // --- Final checks against the stored shapes -------------------------------------------

  const proposals: ImportProposalDraft[] = [];
  for (const { where, payload } of creates) {
    if (payload === null) continue;
    const parsed = createProposalPayloadSchema.safeParse(payload);
    if (parsed.success) proposals.push({ action: 'create', payload: parsed.data });
    // Field problems were reported above with better wording; only add what is new.
    else if (issues.every((issue) => !issue.startsWith(where))) {
      for (const issue of zodIssues(parsed.error)) issues.push(`${where}: ${issue}`);
    }
  }
  for (const payload of updates) proposals.push({ action: 'update', payload });
  for (const payload of links) {
    const parsed = linkProposalPayloadSchema.safeParse(payload);
    if (parsed.success) proposals.push({ action: 'link', payload: parsed.data });
    else {
      const from = byId.get(payload.fromId)?.ref ?? payload.fromId;
      for (const issue of zodIssues(parsed.error)) issues.push(`links from ${from}: ${issue}`);
    }
  }

  if (issues.length > 0) return { ok: false, issues };

  const questions = output.questions
    .map((question) =>
      question.trim().replace(/\s+/g, ' ').slice(0, AI_IMPORT_LIMITS.questionMaxChars),
    )
    .filter((question) => question !== '')
    .slice(0, AI_IMPORT_LIMITS.questionsMax);
  return { ok: true, proposals, questions };
}
