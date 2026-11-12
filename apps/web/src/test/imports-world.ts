/**
 * The AI import part of the fake API (F1.8b): imports that run, become ready or fail, and
 * proposals the review screen accepts, rejects, edits and commits, following the server's
 * rules and messages (`apps/server/src/campaigns/ai-imports.ts`).
 */
import {
  emptyLinksFor,
  emptyRichText,
  emptyTokenUsage,
  importSummarySchema,
  proposalPayloadSchemas,
  startImportRequestSchema,
  type Campaign,
  type CampaignRecord,
  type CommitImportResponse,
  type CreateProposalPayload,
  type ImportDetail,
  type ImportError,
  type ImportProposal,
  type ImportSummary,
  type LinkProposalPayload,
  type ProposalRefs,
  type RecordRef,
  type StartImportRequest,
  type UpdateBefore,
  type UpdateProposalPayload,
  type UsageResponse,
} from '@stagehand/shared';

export const NO_KEY_MESSAGE = 'Add your Anthropic API key in Settings before importing.';
export const IMPORT_RUNNING_MESSAGE =
  'Another import of yours is still running. Wait for it to finish.';
export const NOTHING_ACCEPTED_MESSAGE = 'Accept at least one proposal first.';
/** Notes containing this word make the started import fail (`invalid_output`). */
export const FAIL_WORD = 'gibberish';
/** Notes containing this word are refused like a second running import. */
export const BUSY_WORD = 'busy';

/** The estimate every import gets. */
export const ESTIMATE = {
  model: 'claude-sonnet-5-5',
  inputTokens: 4321,
  context: { index: 3, summary: 1, full: 1 },
  estimatedCostUsd: { likely: 0.04, max: 1.29 },
};

let nextId = 0;
const id = () => {
  nextId += 1;
  return `00000000-0000-4000-9000-${String(nextId).padStart(12, '0')}`;
};

/** An import fixture: ready with no proposals, plus overrides. */
export function importDetail(campaignId: string, overrides: Partial<ImportDetail> = {}) {
  const detail: ImportDetail = {
    id: id(),
    campaignId,
    mode: 'add',
    status: 'ready',
    targetTypes: null,
    recordId: null,
    promptVersion: 1,
    model: 'claude-sonnet-5-5',
    attempts: 1,
    usage: { inputTokens: 5000, outputTokens: 2000, cacheReadTokens: 0, cacheWriteTokens: 0 },
    estimatedCostUsd: 0.03,
    error: null,
    textPreview: '',
    proposalCounts: { create: 0, update: 0, link: 0 },
    createdAt: '2026-11-12T09:00:00.000Z',
    finishedAt: '2026-11-12T09:01:00.000Z',
    committedAt: null,
    text: '',
    questions: [],
    proposals: [],
    refs: {},
    ...overrides,
  };
  return { ...detail, proposalCounts: countsOf(detail.proposals) };
}

const base = (position: number) => ({
  id: id(),
  position,
  reviewState: 'pending' as const,
  original: null,
});

/** A proposed new record: a type and name, plus any payload overrides. */
export function createProposal(
  payload: Partial<CreateProposalPayload> & Pick<CreateProposalPayload, 'type' | 'name'>,
  extra: { position?: number; possibleDuplicates?: RecordRef[] } = {},
): ImportProposal {
  return {
    ...base(extra.position ?? 0),
    action: 'create',
    payload: {
      id: id(),
      parentId: null,
      tags: [],
      publicDescription: emptyRichText(),
      gmNotes: emptyRichText(),
      fields: {},
      links: {},
      otherLinks: [],
      ...payload,
    },
    possibleDuplicates: extra.possibleDuplicates ?? [],
  };
}

/** A proposed change to `record`; `before` is read from it unless given. */
export function updateProposal(
  record: CampaignRecord,
  changes: Omit<UpdateProposalPayload, 'recordId' | 'type'>,
  extra: { position?: number; before?: UpdateBefore | null } = {},
): ImportProposal {
  return {
    ...base(extra.position ?? 0),
    action: 'update',
    payload: { recordId: record.id, type: record.type, ...changes },
    before:
      extra.before !== undefined
        ? extra.before
        : {
            name: record.name,
            tags: record.tags,
            revealedAt: record.revealedAt,
            publicDescription: record.publicDescription,
            gmNotes: record.gmNotes,
            fields: record.fields,
          },
  };
}

export function linkProposal(
  payload: LinkProposalPayload,
  extra: { position?: number; replaces?: RecordRef | null } = {},
): ImportProposal {
  return {
    ...base(extra.position ?? 0),
    action: 'link',
    payload,
    replaces: extra.replaces ?? null,
  };
}

/** `refs` for these records, existing (`proposed: false`) unless said otherwise. */
export function refsOf(
  records: readonly { id: string; type: RecordRef['type']; name: string }[],
  proposed = false,
): ProposalRefs {
  return Object.fromEntries(
    records.map((r) => [r.id, { id: r.id, type: r.type, name: r.name, proposed }]),
  );
}

/** Refs for every record a create proposal makes. */
export function proposedRefs(proposals: readonly ImportProposal[]): ProposalRefs {
  return refsOf(
    proposals.flatMap((p) =>
      p.action === 'create'
        ? [{ id: p.payload.id, type: p.payload.type, name: p.payload.name }]
        : [],
    ),
    true,
  );
}

function countsOf(proposals: readonly ImportProposal[]) {
  const counts = { create: 0, update: 0, link: 0 };
  for (const proposal of proposals) counts[proposal.action] += 1;
  return counts;
}

function summaryOf(detail: ImportDetail): ImportSummary {
  return importSummarySchema.parse({ ...detail, proposalCounts: countsOf(detail.proposals) });
}

/** What a started import becomes once the fake model has answered. */
export type ImportOutcome =
  | { proposals: ImportProposal[]; refs?: ProposalRefs; questions?: string[] }
  | { error: ImportError };

export interface ImportsWorldOptions {
  /** Seeded imports per campaign id. */
  imports?: Record<string, ImportDetail[]>;
  /** What started imports turn into. Default: no proposals (or a failure for `FAIL_WORD`). */
  importResult?: (request: StartImportRequest) => ImportOutcome;
}

interface Ctx {
  hasKey: () => boolean;
  newRecord: (
    overrides: Partial<Omit<CampaignRecord, 'type' | 'fields'>> & {
      type: CampaignRecord['type'];
      fields?: Record<string, unknown>;
    },
  ) => CampaignRecord;
  refused: (status: number, message: string) => Response;
  notFound: (message: string) => Response;
}

const json = (body: unknown, status = 200) => Response.json(body, { status });

/** JSON with object keys sorted, so equal payloads compare equal whatever their key order. */
function stable(value: unknown): string {
  return JSON.stringify(value, (_key, inner: unknown) =>
    inner !== null && typeof inner === 'object' && !Array.isArray(inner)
      ? Object.fromEntries(Object.entries(inner).sort(([a], [b]) => a.localeCompare(b)))
      : inner,
  );
}

/** The imports API over `options`; `respond` answers `/imports…` paths of one campaign. */
export function importsWorld(options: ImportsWorldOptions, ctx: Ctx) {
  const store = new Map<string, ImportDetail[]>(
    Object.entries(options.imports ?? {}).map(([campaignId, list]) => [
      campaignId,
      list.map((detail) => structuredClone(detail)),
    ]),
  );
  /** Each proposal's payload as the model made it. */
  const originals = new Map<string, unknown>();
  for (const list of store.values()) {
    for (const detail of list) {
      for (const p of detail.proposals) originals.set(p.id, p.original ?? p.payload);
    }
  }
  const requests = new Map<string, StartImportRequest>();
  const polls = new Map<string, number>();
  const campaignNames = new Map<string, string>();

  const listOf = (campaignId: string) => {
    let list = store.get(campaignId);
    if (list === undefined) {
      list = [];
      store.set(campaignId, list);
    }
    return list;
  };

  /** On its second read (the review page polling), a running import gets its answer. */
  const advance = (detail: ImportDetail) => {
    if (detail.status !== 'running') return;
    const count = (polls.get(detail.id) ?? 0) + 1;
    polls.set(detail.id, count);
    if (count < 2) return;
    const request = requests.get(detail.id);
    if (request === undefined) return;
    const outcome: ImportOutcome = request.text.includes(FAIL_WORD)
      ? {
          error: {
            code: 'invalid_output',
            message:
              "Claude's answer didn't fit the record shapes, even after one correction. Try again, or split the notes into smaller imports.",
            details: ['creates.0.fields.status: Invalid option'],
          },
        }
      : (options.importResult?.(request) ?? { proposals: [] });
    detail.finishedAt = '2026-11-12T10:02:00.000Z';
    detail.usage = {
      inputTokens: 6000,
      outputTokens: 3000,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    };
    detail.estimatedCostUsd = 0.042;
    if ('error' in outcome) {
      detail.status = 'failed';
      detail.error = outcome.error;
      return;
    }
    detail.status = 'ready';
    detail.proposals = outcome.proposals.map((p) => structuredClone(p));
    for (const p of detail.proposals) originals.set(p.id, p.payload);
    detail.refs = outcome.refs ?? proposedRefs(outcome.proposals);
    detail.questions = outcome.questions ?? [];
    detail.proposalCounts = countsOf(detail.proposals);
  };

  const viewOf = (detail: ImportDetail): ImportDetail => ({
    ...structuredClone(detail),
    proposalCounts: countsOf(detail.proposals),
  });

  function start(found: Campaign, records: CampaignRecord[], rawBody: unknown): Response {
    const parsed = startImportRequestSchema.safeParse(rawBody);
    if (!parsed.success) return ctx.refused(400, parsed.error.issues[0]?.message ?? 'Invalid');
    if (!ctx.hasKey()) return ctx.refused(409, NO_KEY_MESSAGE);
    const request = parsed.data;
    if (request.text.includes(BUSY_WORD)) return ctx.refused(409, IMPORT_RUNNING_MESSAGE);
    if (request.mode === 'bootstrap' && records.length > 0) {
      return ctx.refused(409, 'This campaign already has records. Add to the campaign instead.');
    }
    if (request.mode === 'fill' && !records.some((r) => r.id === request.recordId)) {
      return ctx.notFound('Record not found');
    }
    const detail = importDetail(found.id, {
      mode: request.mode,
      status: 'running',
      targetTypes: request.targetTypes ?? null,
      recordId: request.recordId ?? null,
      usage: emptyTokenUsage(),
      estimatedCostUsd: 0,
      text: request.text,
      textPreview: request.text.slice(0, 200),
      createdAt: new Date().toISOString(),
      finishedAt: null,
    });
    requests.set(detail.id, request);
    listOf(found.id).unshift(detail);
    return json(summaryOf(detail), 202);
  }

  function commit(detail: ImportDetail, records: CampaignRecord[]): Response {
    const accepted = detail.proposals.filter(
      (p) => p.reviewState === 'accepted' || p.reviewState === 'edited',
    );
    if (accepted.length === 0) return ctx.refused(409, NOTHING_ACCEPTED_MESSAGE);
    const result: Omit<CommitImportResponse, 'import'> = {
      created: [],
      updated: [],
      linksAdded: 0,
      skipped: [],
    };
    const refOf = (r: CampaignRecord): RecordRef => ({ id: r.id, type: r.type, name: r.name });
    const nameOf = (recordId: string) => detail.refs[recordId]?.name ?? 'Unknown';
    for (const p of accepted) {
      if (p.action !== 'create') continue;
      const { payload } = p;
      const created = ctx.newRecord({
        id: payload.id,
        type: payload.type,
        name: payload.name,
        parentId: payload.parentId,
        tags: payload.tags,
        publicDescription: payload.publicDescription,
        gmNotes: payload.gmNotes,
        fields: payload.fields,
        source: 'ai_import',
        links: {
          ...emptyLinksFor(payload.type),
          ...Object.fromEntries(
            Object.entries(payload.links).map(([key, ids]) => [
              key,
              ids.map((linked) => ({ id: linked, type: payload.type, name: nameOf(linked) })),
            ]),
          ),
        },
        otherLinks: payload.otherLinks.map((link) => ({
          record: { id: link.recordId, type: payload.type, name: nameOf(link.recordId) },
          label: link.label,
        })),
      });
      records.push(created);
      result.created.push(refOf(created));
    }
    for (const p of accepted) {
      if (p.action === 'update') {
        const target = records.find((r) => r.id === p.payload.recordId);
        if (target === undefined) {
          result.skipped.push({ proposalId: p.id, reason: 'The record was deleted.' });
          continue;
        }
        const { name, publicDescription, gmNotes, addTags, fields } = p.payload;
        if (name !== undefined) target.name = name;
        if (publicDescription !== undefined) target.publicDescription = publicDescription;
        if (gmNotes !== undefined) target.gmNotes = gmNotes;
        if (addTags !== undefined) target.tags = [...new Set([...target.tags, ...addTags])];
        if (fields !== undefined) {
          target.fields = { ...target.fields, ...fields };
        }
        result.updated.push(refOf(target));
      } else if (p.action === 'link') {
        const from = records.find((r) => r.id === p.payload.fromId);
        if (from === undefined) continue;
        const to = { id: p.payload.toId, type: from.type, name: nameOf(p.payload.toId) };
        if (p.payload.fieldKey === null) {
          from.otherLinks = [...from.otherLinks, { record: to, label: p.payload.label }];
        } else {
          from.links = {
            ...from.links,
            [p.payload.fieldKey]: [...(from.links[p.payload.fieldKey] ?? []), to],
          };
        }
        result.linksAdded += 1;
      }
    }
    detail.status = 'committed';
    detail.committedAt = '2026-11-12T10:05:00.000Z';
    return json({ import: summaryOf(detail), ...result });
  }

  function patchOne(detail: ImportDetail, proposalId: string, rawBody: unknown): Response {
    const proposal = detail.proposals.find((p) => p.id === proposalId);
    if (proposal === undefined) return ctx.notFound('Proposal not found');
    const body = (rawBody ?? {}) as { reviewState?: string; payload?: unknown };
    const original = originals.get(proposal.id);
    let payload: unknown = proposal.payload;
    if (body.payload !== undefined) {
      const parsed = proposalPayloadSchemas[proposal.action].safeParse(body.payload);
      if (!parsed.success) return ctx.refused(400, parsed.error.issues[0]?.message ?? 'Invalid');
      payload = parsed.data;
    }
    const same = stable(payload) === stable(original);
    const verdict = body.reviewState ?? proposal.reviewState;
    const accepted = verdict === 'accepted' || verdict === 'edited';
    Object.assign(proposal, {
      payload,
      original: same ? null : original,
      reviewState: !accepted ? verdict : same ? 'accepted' : 'edited',
    });
    if (proposal.action === 'create') {
      const ref = detail.refs[proposal.payload.id];
      if (ref !== undefined) ref.name = proposal.payload.name;
    }
    return json({ proposal: structuredClone(proposal), refs: structuredClone(detail.refs) });
  }

  const NOT_READY: Record<Exclude<ImportDetail['status'], 'ready'>, string> = {
    running: 'This import is still running.',
    failed: 'This import failed, so there is nothing to review.',
    committed: 'This import has already been saved.',
    discarded: 'This import was discarded.',
  };

  function respond(
    found: Campaign,
    records: CampaignRecord[],
    rest: string,
    method: string,
    rawBody: unknown,
  ): Response | null {
    if (!rest.startsWith('/imports')) return null;
    campaignNames.set(found.id, found.name);
    if (found.role !== 'gm') return ctx.refused(403, 'Only the GM can do that');
    const list = listOf(found.id);

    if (rest === '/imports' && method === 'GET') {
      return json({ imports: list.map(summaryOf) });
    }
    if (method !== 'GET' && found.archivedAt !== null) {
      return ctx.refused(409, 'Campaign is archived');
    }
    if (rest === '/imports/estimate' && method === 'POST') {
      const parsed = startImportRequestSchema.safeParse(rawBody);
      if (!parsed.success) return ctx.refused(400, parsed.error.issues[0]?.message ?? 'Invalid');
      if (!ctx.hasKey()) return ctx.refused(409, NO_KEY_MESSAGE);
      return json(ESTIMATE);
    }
    if (rest === '/imports' && method === 'POST') return start(found, records, rawBody);

    const match =
      /^\/imports\/([^/]+)(?:\/(accept-all|commit|discard)|\/proposals\/([^/]+))?$/.exec(rest);
    if (match === null) return null;
    const [, importId, action, proposalId] = match;
    const detail = list.find((d) => d.id === importId);
    if (detail === undefined) return ctx.notFound('Import not found');

    if (action === undefined && proposalId === undefined && method === 'GET') {
      advance(detail);
      return json(viewOf(detail));
    }
    if (action === 'discard' && method === 'POST') {
      if (detail.status === 'ready' || detail.status === 'failed') detail.status = 'discarded';
      else if (detail.status !== 'discarded') return ctx.refused(409, NOT_READY[detail.status]);
      return json(summaryOf(detail));
    }
    if (detail.status !== 'ready') return ctx.refused(409, NOT_READY[detail.status]);
    if (proposalId !== undefined && method === 'PATCH') {
      return patchOne(detail, proposalId, rawBody);
    }
    if (action === 'accept-all' && method === 'POST') {
      for (const p of detail.proposals) if (p.reviewState === 'pending') p.reviewState = 'accepted';
      return json(viewOf(detail));
    }
    if (action === 'commit' && method === 'POST') return commit(detail, records);
    return null;
  }

  /** `GET /api/me/usage` over every import. */
  function usage(): UsageResponse {
    const all = [...store.values()].flat();
    const totals = all.reduce(
      (sum, d) => ({
        inputTokens: sum.inputTokens + d.usage.inputTokens,
        outputTokens: sum.outputTokens + d.usage.outputTokens,
        cacheReadTokens: sum.cacheReadTokens + d.usage.cacheReadTokens,
        cacheWriteTokens: sum.cacheWriteTokens + d.usage.cacheWriteTokens,
      }),
      emptyTokenUsage(),
    );
    return {
      imports: all.map((d) => ({
        id: d.id,
        campaignId: d.campaignId,
        campaignName: campaignNames.get(d.campaignId) ?? 'Campaign',
        mode: d.mode,
        status: d.status,
        model: d.model,
        usage: d.usage,
        estimatedCostUsd: d.estimatedCostUsd,
        createdAt: d.createdAt,
      })),
      totals: {
        imports: all.length,
        usage: totals,
        estimatedCostUsd: all.reduce((sum, d) => sum + (d.estimatedCostUsd ?? 0), 0),
      },
    };
  }

  return { respond, usage, setCampaignName: (c: Campaign) => campaignNames.set(c.id, c.name) };
}
