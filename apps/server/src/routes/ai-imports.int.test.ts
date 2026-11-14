/**
 * AI note import (F1.8a, governance §10, D-27), against a real Postgres with Anthropic faked:
 * the three modes, validate-and-retry, every failure, the review rules, the one-transaction
 * commit, updates to existing records, the cost guardrails, and the two §14 checks (no notes
 * or keys in logs, no keys in responses). Route-level isolation (outsiders 404, players 403)
 * is in the table in `campaigns.int.test.ts`.
 */
import { Writable } from 'node:stream';

import type {
  Campaign,
  CampaignRecord,
  CommitImportResponse,
  CreateProposalPayload,
  ImportDetail,
  ImportEstimateResponse,
  ImportProposal,
  ImportSummary,
  ImportWireOutput,
  PatchProposalResponse,
  RecordListResponse,
  UpdateProposalPayload,
  UsageResponse,
} from '@stagehand/shared';
import { emptyTokenUsage } from '@stagehand/shared';
import { and, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  buildTestApp,
  discordUser,
  SAME_ORIGIN,
  signIn,
  TEST_CREDENTIALS_KEY,
} from '../../test/auth-helpers';
import { wire, wireCreate } from '../../test/import-fixtures';
import { richText } from '../../test/record-fixtures';
import { userMessageText } from '../ai-import/prompt';
import { failInterruptedImports } from '../campaigns/ai-imports';
import { saveProviderKey } from '../credentials/store';
import type { DbHandle } from '../db/client';
import { aiImports, aiProposals, campaignMembers, recordLinks, records, users } from '../db/schema';
import type { ImportCallInput, ImportCallResult, TokenCountResult } from '../providers/anthropic';

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

interface Person {
  cookie: string;
  id: string;
}

const GM_KEY = 'sk-ant-api03-ImportGmImportGmImportGm0123456789_-imp1';
/** Marks the GM's notes and the model's answer, to look for in logs. */
const NOTES_MARK = 'ZEBRAQUARTZ';
const ANSWER_MARK = 'OBSIDIANLARK';
const USAGE = { inputTokens: 3000, outputTokens: 800, cacheReadTokens: 2000, cacheWriteTokens: 0 };

/** Finds the ref (`E3`) the context pack gave a record, from the message sent to the model. */
function refIn(user: string, name: string): string {
  const line = user.split('\n').find((candidate) => candidate.includes(`| ${name}`));
  const ref = line?.split(' | ')[0];
  if (ref === undefined) throw new Error(`"${name}" is not in the context pack`);
  return ref;
}

const field = (key: string, value: string) => ({ key, value });

type Answer = ImportWireOutput | ImportCallResult | Error;
type Script = (input: ImportCallInput, ref: (name: string) => string) => Answer | Promise<Answer>;

describe('AI import API', () => {
  let app: FastifyInstance;
  let handle: DbHandle;
  let gm: Person;
  let player: Person;
  let keyless: Person;
  /** One answer per records call, in order. */
  let scripts: Script[] = [];
  const calls: ImportCallInput[] = [];
  /**
   * One answer per questions call (D-30), in order. With none queued, the model asks nothing
   * and costs nothing, so the import goes straight on to its records call.
   */
  let questionScripts: Script[] = [];
  const questionCalls: ImportCallInput[] = [];
  let nextCount: TokenCountResult = { status: 'ok', inputTokens: 5000 };
  const countCalls: Pick<ImportCallInput, 'apiKey' | 'system' | 'user'>[] = [];
  const logLines: string[] = [];
  const responseBodies: string[] = [];

  async function generate(input: ImportCallInput): Promise<ImportCallResult> {
    const asking = input.user.step.includes('phase: questions');
    (asking ? questionCalls : calls).push(input);
    const script = (asking ? questionScripts : scripts).shift();
    if (script === undefined && !asking) throw new Error('the fake Anthropic ran out of answers');
    const answer =
      script === undefined ? wire() : await script(input, (name) => refIn(input.user.prefix, name));
    if (answer instanceof Error) throw answer;
    if ('status' in answer) return answer;
    return {
      status: 'ok',
      text: JSON.stringify(answer),
      model: 'claude-sonnet-5-5',
      usage: script === undefined ? emptyTokenUsage() : USAGE,
      turn: { content: [{ type: 'text', text: 'previous turn' }] },
    };
  }

  beforeAll(async () => {
    const logStream = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        logLines.push(chunk.toString('utf8'));
        callback();
      },
    });
    ({ app, handle } = await buildTestApp({
      logger: { level: 'trace', stream: logStream },
      anthropic: {
        generateImport: generate,
        countImportTokens: (input) => {
          countCalls.push(input);
          return Promise.resolve(nextCount);
        },
      },
    }));
    async function person(discordId: string, name: string): Promise<Person> {
      const cookie = await signIn(app, discordUser({ id: discordId, global_name: name }));
      const [row] = await handle.db.select().from(users).where(eq(users.discordId, discordId));
      return { cookie, id: row?.id ?? '' };
    }
    gm = await person('9001', 'Import GM');
    player = await person('9002', 'Import Player');
    keyless = await person('9003', 'Keyless GM');
    await saveProviderKey(handle.db, TEST_CREDENTIALS_KEY, gm.id, 'anthropic', GM_KEY);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    scripts = [];
    questionScripts = [];
    // Each test starts with a fresh hourly quota.
    await handle.db
      .update(aiImports)
      .set({ createdAt: sql`${aiImports.createdAt} - interval '2 hours'` });
  });

  async function call(method: Method, url: string, who: Person | null, payload?: unknown) {
    const response = await app.inject({
      method,
      url,
      headers: { ...SAME_ORIGIN, cookie: who?.cookie ?? '' },
      ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
    });
    responseBodies.push(`${JSON.stringify(response.headers)}\n${response.body}`);
    return response;
  }

  async function newCampaign(name: string, owner = gm): Promise<Campaign> {
    const response = await call('POST', '/api/campaigns', owner, { name });
    expect(response.statusCode).toBe(201);
    return response.json<Campaign>();
  }

  const importsUrl = (c: Campaign) => `/api/campaigns/${c.id}/imports`;
  const recordsUrl = (c: Campaign) => `/api/campaigns/${c.id}/records`;

  async function makeRecord(c: Campaign, body: Record<string, unknown>): Promise<CampaignRecord> {
    const response = await call('POST', recordsUrl(c), gm, body);
    expect(response.statusCode, response.body).toBe(201);
    return response.json<CampaignRecord>();
  }

  async function readRecord(c: Campaign, id: string): Promise<CampaignRecord> {
    const response = await call('GET', `${recordsUrl(c)}/${id}`, gm);
    expect(response.statusCode, response.body).toBe(200);
    return response.json<CampaignRecord>();
  }

  async function recordNames(c: Campaign): Promise<string[]> {
    const response = await call('GET', recordsUrl(c), gm);
    return response.json<RecordListResponse>().records.map((record) => record.name);
  }

  async function detailOf(c: Campaign, importId: string): Promise<ImportDetail> {
    const response = await call('GET', `${importsUrl(c)}/${importId}`, gm);
    expect(response.statusCode, response.body).toBe(200);
    return response.json<ImportDetail>();
  }

  /** Starts an import and waits for the background job to finish it. */
  async function runImport(c: Campaign, body: Record<string, unknown>): Promise<ImportDetail> {
    const started = await call('POST', importsUrl(c), gm, body);
    expect(started.statusCode, started.body).toBe(202);
    return settle(c, started.json<ImportSummary>().id);
  }

  /** Waits until a step of the import is no longer running. */
  async function settle(c: Campaign, id: string): Promise<ImportDetail> {
    for (let tries = 0; tries < 300; tries += 1) {
      const detail = await detailOf(c, id);
      if (detail.status !== 'running') return detail;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error('the import never finished');
  }

  const proposalUrl = (c: Campaign, detail: ImportDetail, proposal: ImportProposal) =>
    `${importsUrl(c)}/${detail.id}/proposals/${proposal.id}`;

  async function review(
    c: Campaign,
    detail: ImportDetail,
    proposal: ImportProposal,
    patch: Record<string, unknown>,
  ): Promise<ImportProposal> {
    const response = await call('PATCH', proposalUrl(c, detail, proposal), gm, patch);
    expect(response.statusCode, response.body).toBe(200);
    return response.json<PatchProposalResponse>().proposal;
  }

  async function commit(c: Campaign, detail: ImportDetail): Promise<CommitImportResponse> {
    const response = await call('POST', `${importsUrl(c)}/${detail.id}/commit`, gm);
    expect(response.statusCode, response.body).toBe(200);
    return response.json<CommitImportResponse>();
  }

  function createNamed(detail: ImportDetail, name: string) {
    const found = detail.proposals.find((p) => p.action === 'create' && p.payload.name === name);
    if (found?.action !== 'create') throw new Error(`no create proposal named ${name}`);
    return found;
  }

  async function importRows(c: Campaign) {
    return handle.db.select().from(aiImports).where(eq(aiImports.campaignId, c.id));
  }

  /** The bootstrap answer most tests build on: an area, a spot in it, an NPC and a faction. */
  const harbor: Script = () =>
    wire({
      creates: [
        wireCreate({
          id: 'N1',
          type: 'area',
          name: 'Saltmarsh',
          tags: ['coast'],
          fields: [
            field('publicDescription', 'A fishing port.'),
            field('overview', 'Kept in line by the [[N4]].'),
          ],
        }),
        wireCreate({
          id: 'N2',
          type: 'spot',
          name: 'The Drowned Rat',
          area: 'N1',
          fields: [field('readAloud', 'Smoke and **salt**.')],
        }),
        wireCreate({
          id: 'N3',
          type: 'npc',
          name: 'Captain Voss',
          fields: [
            field('status', 'Alive'),
            field('secrets', `Takes coin from smugglers. ${ANSWER_MARK}`),
          ],
        }),
        wireCreate({ id: 'N4', type: 'faction', name: 'Harbor Watch' }),
      ],
      links: [
        { from: 'N3', to: 'N2', field: 'homeSpot', label: '' },
        { from: 'N3', to: 'N4', field: 'factions', label: '' },
        { from: 'N4', to: 'N3', field: 'leaders', label: '' },
        { from: 'N3', to: 'N1', field: '', label: 'grew up in' },
      ],
      questions: ['Who pays the Watch?'],
    });

  /** A campaign holding the committed harbor import. */
  async function harborCampaign(name: string) {
    const campaign = await newCampaign(name);
    scripts = [harbor];
    const detail = await runImport(campaign, { mode: 'bootstrap', text: 'A port town.' });
    await call('POST', `${importsUrl(campaign)}/${detail.id}/accept-all`, gm);
    const { created } = await commit(campaign, detail);
    const id = (recordName: string) => created.find((r) => r.name === recordName)?.id ?? '';
    return {
      campaign,
      saltmarsh: id('Saltmarsh'),
      rat: id('The Drowned Rat'),
      voss: id('Captain Voss'),
      watch: id('Harbor Watch'),
    };
  }

  describe('bootstrap, review and commit', () => {
    let campaign: Campaign;
    let detail: ImportDetail;

    beforeAll(async () => {
      campaign = await newCampaign('Bootstrap Campaign');
    });

    it('answers 202 at once and finishes in the background', async () => {
      let release: () => void = () => undefined;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      scripts = [
        async (input, ref) => {
          await held;
          return harbor(input, ref);
        },
      ];

      const started = await call('POST', importsUrl(campaign), gm, {
        mode: 'bootstrap',
        text: `  A port town called Saltmarsh. ${NOTES_MARK}  `,
      });

      expect(started.statusCode).toBe(202);
      const summary = started.json<ImportSummary>();
      expect(summary).toMatchObject({
        campaignId: campaign.id,
        mode: 'bootstrap',
        status: 'running',
        model: 'claude-sonnet-5-5',
        promptVersion: 5,
        phase: 'questions',
        steps: 1,
        attempts: 0,
        error: null,
        textPreview: `A port town called Saltmarsh. ${NOTES_MARK}`,
        proposalCounts: { create: 0, update: 0, link: 0 },
        finishedAt: null,
      });
      expect((await detailOf(campaign, summary.id)).status).toBe('running');

      // While it runs, the same GM can't start another, in any campaign.
      const second = await call('POST', importsUrl(campaign), gm, {
        mode: 'bootstrap',
        text: 'More notes.',
      });
      expect(second.statusCode).toBe(409);
      expect(second.json<{ message: string }>().message).toContain('still running');

      release();
      for (let tries = 0; tries < 300; tries += 1) {
        detail = await detailOf(campaign, summary.id);
        if (detail.status !== 'running') break;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(detail.status).toBe('ready');
    });

    it("sends the prompt, the empty campaign and the notes under the GM's key", () => {
      expect(calls).toHaveLength(1);
      const [sent] = calls;
      expect(sent?.apiKey).toBe(GM_KEY);
      expect(sent?.system).toContain('`voiceAndMannerisms`');
      expect(sent?.user.prefix).toContain('The campaign has no records yet.');
      expect(sent?.user.step).toContain('mode: bootstrap');
      expect(sent?.user.prefix).toContain(`A port town called Saltmarsh. ${NOTES_MARK}`);
      // The questions step came first, with the same prefix.
      expect(questionCalls.at(-1)?.user.prefix).toBe(sent?.user.prefix);
      expect(sent?.retry).toBeUndefined();
    });

    it('stores the answer as proposals, with usage and cost, and saves no record', async () => {
      expect(detail).toMatchObject({
        status: 'ready',
        attempts: 1,
        usage: USAGE,
        text: `A port town called Saltmarsh. ${NOTES_MARK}`,
        questions: ['Who pays the Watch?'],
        proposalCounts: { create: 4, update: 0, link: 0 },
      });
      // 3000 in and 800 out at $2 / $10 per million, 2000 cached at $0.10.
      expect(detail.estimatedCostUsd).toBeCloseTo(0.006 + 0.008 + 0.0002);
      expect(detail.finishedAt).not.toBeNull();
      expect(detail.proposals.map((p) => [p.position, p.action, p.reviewState])).toEqual([
        [0, 'create', 'pending'],
        [1, 'create', 'pending'],
        [2, 'create', 'pending'],
        [3, 'create', 'pending'],
      ]);

      const saltmarsh = createNamed(detail, 'Saltmarsh');
      const rat = createNamed(detail, 'The Drowned Rat');
      const voss = createNamed(detail, 'Captain Voss');
      const watch = createNamed(detail, 'Harbor Watch');
      expect(rat.payload).toMatchObject({
        type: 'spot',
        parentId: saltmarsh.payload.id,
        fields: { readAloud: expect.anything() as unknown },
      });
      // Links between proposals already use the ids the records will get.
      expect(voss.payload).toMatchObject({
        fields: { status: 'alive' },
        links: { homeSpot: [rat.payload.id], factions: [watch.payload.id] },
        otherLinks: [{ recordId: saltmarsh.payload.id, label: 'grew up in' }],
      });
      expect(watch.payload.links).toEqual({ leaders: [voss.payload.id] });
      expect(JSON.stringify(saltmarsh.payload.fields)).toContain(watch.payload.id);
      expect(saltmarsh.original).toBeNull();
      expect(saltmarsh.possibleDuplicates).toEqual([]);

      expect(detail.refs[rat.payload.id]).toEqual({
        id: rat.payload.id,
        type: 'spot',
        name: 'The Drowned Rat',
        proposed: true,
      });
      expect(await recordNames(campaign)).toEqual([]);
    });

    it('lists the import for the campaign', async () => {
      const response = await call('GET', importsUrl(campaign), gm);

      expect(response.statusCode).toBe(200);
      const { imports } = response.json<{ imports: ImportSummary[] }>();
      expect(imports).toHaveLength(1);
      expect(imports[0]).toMatchObject({ id: detail.id, status: 'ready' });
      expect(imports[0]).not.toHaveProperty('text');
      expect(imports[0]).not.toHaveProperty('proposals');
    });

    it('accepts, rejects and resets a proposal', async () => {
      const watch = createNamed(detail, 'Harbor Watch');

      expect((await review(campaign, detail, watch, { reviewState: 'accepted' })).reviewState).toBe(
        'accepted',
      );
      expect((await review(campaign, detail, watch, { reviewState: 'rejected' })).reviewState).toBe(
        'rejected',
      );
      expect((await review(campaign, detail, watch, { reviewState: 'pending' })).reviewState).toBe(
        'pending',
      );
    });

    it('stores an edit, and calls an accepted edit "edited"', async () => {
      const voss = createNamed(detail, 'Captain Voss');
      const payload: CreateProposalPayload = {
        ...voss.payload,
        name: 'Captain Ilsa Voss',
        tags: ['watch'],
        fields: { ...voss.payload.fields, appearance: 'Grey coat.' },
      };

      // An edit alone keeps the verdict.
      const edited = await review(campaign, detail, voss, { payload });
      expect(edited).toMatchObject({
        reviewState: 'pending',
        payload: { name: 'Captain Ilsa Voss' },
      });
      expect(edited.action === 'create' && edited.original?.name).toBe('Captain Voss');

      const accepted = await review(campaign, detail, voss, { reviewState: 'accepted' });
      expect(accepted.reviewState).toBe('edited');

      // Putting the model's version back makes it a plain accept again.
      const restored = await review(campaign, detail, voss, { payload: voss.payload });
      expect(restored).toMatchObject({ reviewState: 'accepted', original: null });

      await review(campaign, detail, voss, { payload, reviewState: 'accepted' });
      const reloaded = await detailOf(campaign, detail.id);
      expect(createNamed(reloaded, 'Captain Ilsa Voss').reviewState).toBe('edited');
      // Other cards now show the new name.
      expect(reloaded.refs[voss.payload.id]?.name).toBe('Captain Ilsa Voss');
    });

    it('lets links be removed but not added, and keeps a proposal about its record', async () => {
      const voss = createNamed(await detailOf(campaign, detail.id), 'Captain Ilsa Voss');
      const watch = createNamed(detail, 'Harbor Watch');
      const rat = createNamed(detail, 'The Drowned Rat');
      const url = proposalUrl(campaign, detail, voss);
      const bad = async (payload: Record<string, unknown>, message: string) => {
        const response = await call('PATCH', url, gm, { payload });
        expect(response.statusCode, response.body).toBe(400);
        expect(response.json<{ message: string }>().message).toContain(message);
      };

      await bad(
        { ...voss.payload, links: { ...voss.payload.links, factions: [rat.payload.id] } },
        'removed during review, not added',
      );
      await bad(
        { ...voss.payload, otherLinks: [{ recordId: watch.payload.id, label: null }] },
        'removed during review, not added',
      );
      await bad({ ...voss.payload, id: watch.payload.id }, "can't change");
      await bad({ ...voss.payload, type: 'faction', fields: {}, links: {} }, "can't change");
      await bad({ ...voss.payload, fields: { status: 'asleep' } }, 'fields.status');
      await bad({ ...voss.payload, parentId: rat.payload.parentId }, 'Only spots have an area');
      const empty = await call('PATCH', url, gm, {});
      expect(empty.statusCode).toBe(400);

      // Removing the home spot is fine.
      const trimmed = await review(campaign, detail, voss, {
        payload: { ...voss.payload, links: { ...voss.payload.links, homeSpot: [] } },
      });
      expect(trimmed.action === 'create' && trimmed.payload.links).toEqual({
        homeSpot: [],
        factions: [watch.payload.id],
      });
    });

    it('refuses to save while nothing is accepted elsewhere, then accepts all', async () => {
      const fresh = await newCampaign('Nothing Accepted');
      scripts = [harbor];
      const untouched = await runImport(fresh, { mode: 'bootstrap', text: 'A port town.' });
      const refused = await call('POST', `${importsUrl(fresh)}/${untouched.id}/commit`, gm);
      expect(refused.statusCode).toBe(409);
      expect(refused.json<{ message: string }>().message).toContain('Accept at least one');

      const response = await call('POST', `${importsUrl(campaign)}/${detail.id}/accept-all`, gm);
      expect(response.statusCode).toBe(200);
      expect(response.json<ImportDetail>().proposals.map((p) => p.reviewState)).toEqual([
        'accepted',
        'accepted',
        'edited',
        'accepted',
      ]);
    });

    it('saves every accepted proposal in one go, under the promised ids', async () => {
      const before = await detailOf(campaign, detail.id);
      const result = await commit(campaign, before);

      expect(result.import).toMatchObject({ id: detail.id, status: 'committed' });
      expect(result.import.committedAt).not.toBeNull();
      // Areas first, spots last.
      expect(result.created.map((r) => r.name)).toEqual([
        'Saltmarsh',
        'Captain Ilsa Voss',
        'Harbor Watch',
        'The Drowned Rat',
      ]);
      expect(result).toMatchObject({ updated: [], linksAdded: 0, skipped: [] });

      const ids = Object.fromEntries(result.created.map((r) => [r.name, r.id]));
      for (const proposal of before.proposals) {
        if (proposal.action === 'create') {
          expect(ids[proposal.payload.name]).toBe(proposal.payload.id);
        }
      }

      const voss = await readRecord(campaign, ids['Captain Ilsa Voss'] ?? '');
      expect(voss).toMatchObject({
        type: 'npc',
        source: 'ai_import',
        tags: ['watch'],
        fields: { status: 'alive', appearance: 'Grey coat.' },
        // The home spot was removed in review.
        links: { homeSpot: [], factions: [{ name: 'Harbor Watch' }] },
        otherLinks: [{ record: { name: 'Saltmarsh' }, label: 'grew up in' }],
      });
      const rat = await readRecord(campaign, ids['The Drowned Rat'] ?? '');
      expect(rat).toMatchObject({ source: 'ai_import', parentId: ids['Saltmarsh'] });
      expect((await readRecord(campaign, ids['Harbor Watch'] ?? '')).links).toEqual({
        leaders: [{ id: voss.id, type: 'npc', name: 'Captain Ilsa Voss' }],
        members: [],
        alliesAndEnemies: [],
      });

      // The mention in Saltmarsh's overview became a mention link.
      const mentions = await handle.db
        .select()
        .from(recordLinks)
        .where(
          and(
            eq(recordLinks.fromRecordId, ids['Saltmarsh'] ?? ''),
            eq(recordLinks.kind, 'mention'),
          ),
        );
      expect(mentions.map((row) => row.toRecordId)).toEqual([ids['Harbor Watch']]);

      const rows = await handle.db
        .select()
        .from(records)
        .where(eq(records.campaignId, campaign.id));
      expect(rows.every((row) => row.aiImportId === detail.id && row.source === 'ai_import')).toBe(
        true,
      );
    });

    it('is closed once saved', async () => {
      const closed = await detailOf(campaign, detail.id);
      expect(closed.status).toBe('committed');
      // The records exist now, so the cards point at real records.
      expect(Object.values(closed.refs).every((ref) => !ref.proposed)).toBe(true);

      const first = closed.proposals[0];
      if (first === undefined) throw new Error('no proposals');
      for (const [method, url, body] of [
        ['POST', `${importsUrl(campaign)}/${detail.id}/commit`, undefined],
        ['POST', `${importsUrl(campaign)}/${detail.id}/accept-all`, undefined],
        ['POST', `${importsUrl(campaign)}/${detail.id}/discard`, undefined],
        ['PATCH', proposalUrl(campaign, closed, first), { reviewState: 'rejected' }],
      ] as const) {
        const response = await call(method, url, gm, body);
        expect(response.statusCode, url).toBe(409);
        expect(response.json<{ message: string }>().message).toContain('already been saved');
      }
      expect(await recordNames(campaign)).toHaveLength(4);
    });

    it('refuses a bootstrap once the campaign has records', async () => {
      const response = await call('POST', importsUrl(campaign), gm, {
        mode: 'bootstrap',
        text: 'Start again.',
      });

      expect(response.statusCode).toBe(409);
      expect(response.json<{ message: string }>().message).toContain('already has records');
      expect(await importRows(campaign)).toHaveLength(1);
    });
  });

  describe('adding to a campaign', () => {
    let world: Awaited<ReturnType<typeof harborCampaign>>;
    let detail: ImportDetail;

    beforeAll(async () => {
      world = await harborCampaign('Add Campaign');
      await makeRecord(world.campaign, { type: 'faction', name: 'Tidecallers' });
      await makeRecord(world.campaign, {
        type: 'spot',
        name: 'Customs House',
        parentId: world.saltmarsh,
      });
      calls.length = 0;
    });

    it('tells the model what exists, and takes updates, links and new records back', async () => {
      scripts = [
        (_input, ref) =>
          wire({
            creates: [
              wireCreate({ id: 'N1', type: 'npc', name: 'Mira', tags: ['docks'] }),
              // The model shouldn't, but if it proposes a record that exists, it is flagged.
              wireCreate({ id: 'N2', type: 'npc', name: 'Voss' }),
            ],
            updates: [
              {
                id: ref('Captain Voss'),
                fields: [
                  field('status', 'missing'),
                  field('gmNotes', 'Last seen with [[N1]].'),
                  field('appearance', 'Salt-white beard.'),
                ],
                addTags: ['missing', 'missing'],
              },
            ],
            links: [
              { from: ref('Captain Voss'), to: ref('Customs House'), field: 'homeSpot', label: '' },
              { from: ref('Harbor Watch'), to: 'N1', field: 'members', label: '' },
              { from: ref('Harbor Watch'), to: ref('Tidecallers'), field: '', label: 'rival of' },
              { from: 'N1', to: ref('Harbor Watch'), field: 'factions', label: '' },
            ],
          }),
      ];

      detail = await runImport(world.campaign, {
        mode: 'add',
        text: 'Captain Voss has gone missing. Mira, a dockhand, joined the Harbor Watch.',
      });

      expect(detail.status).toBe('ready');
      expect(detail.proposalCounts).toEqual({ create: 2, update: 1, link: 3 });

      const user = calls[0] === undefined ? '' : userMessageText(calls[0].user);
      expect(user).toContain('mode: add');
      // Every record is in the index; the ones the notes name are shown in full.
      for (const name of ['Saltmarsh', 'The Drowned Rat', 'Tidecallers', 'Customs House']) {
        expect(user).toContain(`| ${name}`);
      }
      expect(user).toMatch(/<record id="E\d+" type="npc" name="Captain Voss" detail="full">/);
      expect(user).toMatch(/<record id="E\d+" type="faction" name="Harbor Watch" detail="full">/);
      expect(user).toContain(ANSWER_MARK); // Voss's secrets, from the first import.
      // No record id ever leaves the server.
      expect(user).not.toContain(world.voss);
    });

    it('shows an update as a diff against the record as it is now', async () => {
      const update = detail.proposals.find((p) => p.action === 'update');
      if (update?.action !== 'update') throw new Error('no update proposal');

      expect(update.payload).toMatchObject({
        recordId: world.voss,
        type: 'npc',
        addTags: ['missing'],
        fields: { status: 'missing', appearance: 'Salt-white beard.' },
      });
      expect(JSON.stringify(update.payload.gmNotes)).toContain('Mira');
      expect(update.before).toMatchObject({
        name: 'Captain Voss',
        tags: [],
        revealedAt: null,
        fields: { status: 'alive' },
      });

      // The diff is read fresh: a change made since shows up.
      await call('PATCH', `${recordsUrl(world.campaign)}/${world.voss}`, gm, {
        fields: { appearance: 'Grey coat.' },
        tags: ['watch'],
      });
      const reloaded = (await detailOf(world.campaign, detail.id)).proposals.find(
        (p) => p.action === 'update',
      );
      expect(reloaded?.action === 'update' && reloaded.before).toMatchObject({
        tags: ['watch'],
        fields: { status: 'alive', appearance: 'Grey coat.' },
      });
    });

    it('flags a new record that looks like an existing one', () => {
      expect(createNamed(detail, 'Voss').possibleDuplicates).toEqual([
        { id: world.voss, type: 'npc', name: 'Captain Voss' },
      ]);
      expect(createNamed(detail, 'Mira').possibleDuplicates).toEqual([]);
    });

    it('says what a single-record link would replace', () => {
      const links = detail.proposals.flatMap((p) => (p.action === 'link' ? [p] : []));
      const homeSpot = links.find((p) => p.payload.fieldKey === 'homeSpot');
      const rival = links.find((p) => p.payload.fieldKey === null);

      expect(homeSpot?.replaces).toEqual({ id: world.rat, type: 'spot', name: 'The Drowned Rat' });
      expect(rival).toMatchObject({ payload: { label: 'rival of' }, replaces: null });
      expect(detail.refs[world.watch]).toMatchObject({ name: 'Harbor Watch', proposed: false });
    });

    it('lets an update drop or reword a change, not gain one', async () => {
      const update = detail.proposals.find((p) => p.action === 'update');
      if (update?.action !== 'update') throw new Error('no update proposal');
      const url = proposalUrl(world.campaign, detail, update);
      const kept = Object.fromEntries(
        Object.entries(update.payload.fields ?? {}).filter(([key]) => key !== 'appearance'),
      );

      const gained = await call('PATCH', url, gm, {
        payload: { ...update.payload, name: 'Admiral Voss' },
      });
      expect(gained.statusCode).toBe(400);
      expect(gained.json<{ message: string }>().message).toContain('not gain new ones');
      const newField = await call('PATCH', url, gm, {
        payload: {
          ...update.payload,
          fields: { ...update.payload.fields, voiceAndMannerisms: 'Gruff' },
        },
      });
      expect(newField.statusCode).toBe(400);
      const moved = await call('PATCH', url, gm, {
        payload: { ...update.payload, recordId: world.watch },
      });
      expect(moved.statusCode).toBe(400);

      const payload: UpdateProposalPayload = { ...update.payload, fields: kept };
      const edited = await review(world.campaign, detail, update, {
        payload,
        reviewState: 'accepted',
      });
      expect(edited).toMatchObject({
        reviewState: 'edited',
        payload: { fields: { status: 'missing' } },
      });
      expect(edited.action === 'update' && edited.payload.fields).not.toHaveProperty('appearance');

      // A link's relationship can be reworded; its ends can't move.
      const rival = detail.proposals.find(
        (p) => p.action === 'link' && p.payload.fieldKey === null,
      );
      if (rival?.action !== 'link') throw new Error('no free-form link');
      const relabelled = await review(world.campaign, detail, rival, {
        payload: { ...rival.payload, label: 'at war with' },
      });
      expect(relabelled.payload).toMatchObject({ label: 'at war with' });
      const rewired = await call('PATCH', proposalUrl(world.campaign, detail, rival), gm, {
        payload: { ...rival.payload, toId: world.voss },
      });
      expect(rewired.statusCode).toBe(400);
    });

    it('applies updates and links to existing records, changing only what was proposed', async () => {
      await review(world.campaign, detail, createNamed(detail, 'Voss'), {
        reviewState: 'rejected',
      });
      await call('POST', `${importsUrl(world.campaign)}/${detail.id}/accept-all`, gm);

      const result = await commit(world.campaign, detail);

      expect(result.created.map((r) => r.name)).toEqual(['Mira']);
      expect(result.updated).toEqual([{ id: world.voss, type: 'npc', name: 'Captain Voss' }]);
      expect(result.linksAdded).toBe(3);
      expect(result.skipped).toEqual([]);

      const voss = await readRecord(world.campaign, world.voss);
      expect(voss).toMatchObject({
        // The record keeps where it came from: the first import.
        source: 'ai_import',
        // Tags are added to, never replaced.
        tags: ['watch', 'missing'],
        // `appearance` was dropped from the update, so the GM's own edit stands.
        fields: { status: 'missing', appearance: 'Grey coat.' },
        // A field that holds one record is replaced.
        links: { homeSpot: [{ name: 'Customs House' }], factions: [{ name: 'Harbor Watch' }] },
      });
      expect(JSON.stringify(voss.fields)).toContain(ANSWER_MARK);
      const mira = result.created[0]?.id ?? '';
      expect(JSON.stringify(voss.gmNotes)).toContain(mira);

      const watch = await readRecord(world.campaign, world.watch);
      // A field that holds many keeps its links and gains the new one.
      expect(watch.links['leaders']?.map((r) => r.name)).toEqual(['Captain Voss']);
      expect(watch.links['members']?.map((r) => r.name)).toEqual(['Mira']);
      expect(watch.otherLinks).toEqual([
        {
          record: expect.objectContaining({ name: 'Tidecallers' }) as unknown,
          label: 'at war with',
        },
      ]);
      expect((await readRecord(world.campaign, mira)).links['factions']).toEqual([
        { id: world.watch, type: 'faction', name: 'Harbor Watch' },
      ]);
      expect(await recordNames(world.campaign)).not.toContain('Voss');
    });
  });

  describe('props (F1.10, D-41)', () => {
    let world: Awaited<ReturnType<typeof harborCampaign>>;

    beforeAll(async () => {
      world = await harborCampaign('Prop Campaign');
      calls.length = 0;
    });

    it("saves new Props at their Spots, new or existing, through each Prop's spot link", async () => {
      scripts = [
        (_input, ref) =>
          wire({
            creates: [
              wireCreate({
                id: 'N1',
                type: 'prop',
                name: 'Notice board',
                fields: [
                  field('publicDescription', 'Pinned with job offers.'),
                  field('hiddenDetails', 'A map is tucked behind the posters.'),
                ],
              }),
              wireCreate({ id: 'N2', type: 'spot', name: 'Fish market', area: ref('Saltmarsh') }),
              wireCreate({ id: 'N3', type: 'prop', name: 'Old well' }),
            ],
            links: [
              { from: 'N1', to: ref('The Drowned Rat'), field: 'spot', label: '' },
              // Written from the Spot's side: turned around into the Prop's own link.
              { from: 'N2', to: 'N3', field: 'propsHere', label: '' },
            ],
          }),
      ];
      const detail = await runImport(world.campaign, {
        mode: 'add',
        text: 'The Drowned Rat has a notice board. The new fish market has an old well.',
      });
      expect(detail.status).toBe('ready');
      expect(detail.proposalCounts).toEqual({ create: 3, update: 0, link: 0 });
      expect(createNamed(detail, 'Old well').payload.links).toEqual({
        spot: [createNamed(detail, 'Fish market').payload.id],
      });

      await call('POST', `${importsUrl(world.campaign)}/${detail.id}/accept-all`, gm);
      const { created } = await commit(world.campaign, detail);
      const id = (name: string) => created.find((r) => r.name === name)?.id ?? '';

      const board = await readRecord(world.campaign, id('Notice board'));
      expect(board).toMatchObject({
        type: 'prop',
        parentId: null,
        revealedAt: null,
        links: { spot: [{ id: world.rat, name: 'The Drowned Rat' }] },
      });
      expect(JSON.stringify(board.fields)).toContain('A map is tucked behind the posters.');
      const well = await readRecord(world.campaign, id('Old well'));
      expect(well.links).toMatchObject({ spot: [{ name: 'Fish market' }] });
    });

    it("tells the model which Spot each Prop is at, and lists a Spot's Props", async () => {
      scripts = [() => wire()];
      calls.length = 0;
      await runImport(world.campaign, {
        mode: 'add',
        text: 'The Drowned Rat repaints its sign.',
      });

      const user = calls[0] === undefined ? '' : userMessageText(calls[0].user);
      const ratRef = /(E\d+) \| spot \| The Drowned Rat/.exec(user)?.[1];
      expect(ratRef).toBeDefined();
      expect(user).toContain(`| prop | Notice board | at ${ratRef ?? ''}`);
      expect(user).toMatch(/<record id="E\d+" type="spot" name="The Drowned Rat" detail="full">/);
      expect(user).toMatch(/propsHere: E\d+/);
    });
  });

  describe('what a commit refuses, skips and rolls back', () => {
    it('refuses to save a spot whose area was left out, naming both', async () => {
      const campaign = await newCampaign('Rejected Area');
      const docks = await makeRecord(campaign, { type: 'area', name: 'Old Docks' });
      scripts = [harbor];
      const detail = await runImport(campaign, { mode: 'add', text: 'A port town.' });
      await call('POST', `${importsUrl(campaign)}/${detail.id}/accept-all`, gm);
      await review(campaign, detail, createNamed(detail, 'Saltmarsh'), { reviewState: 'rejected' });
      await review(campaign, detail, createNamed(detail, 'Harbor Watch'), {
        reviewState: 'rejected',
      });

      const refused = await call('POST', `${importsUrl(campaign)}/${detail.id}/commit`, gm);
      expect(refused.statusCode).toBe(409);
      expect(refused.json<{ message: string }>().message).toBe(
        '"The Drowned Rat" is a spot in "Saltmarsh", which isn\'t accepted. Accept that area, pick another area for the spot, or reject the spot.',
      );
      expect(await recordNames(campaign)).toEqual(['Old Docks']);

      // The GM moves the spot to an area that exists; an area of another campaign won't do.
      const rat = createNamed(detail, 'The Drowned Rat');
      const elsewhere = await makeRecord(await newCampaign('Elsewhere'), {
        type: 'area',
        name: 'Far',
      });
      const wrong = await call('PATCH', proposalUrl(campaign, detail, rat), gm, {
        payload: { ...rat.payload, parentId: elsewhere.id },
      });
      expect(wrong.statusCode).toBe(400);
      await review(campaign, detail, rat, { payload: { ...rat.payload, parentId: docks.id } });

      const result = await commit(campaign, detail);
      expect(result.created.map((r) => r.name)).toEqual(['Captain Voss', 'The Drowned Rat']);
      const voss = await readRecord(campaign, result.created[0]?.id ?? '');
      // Links to the two rejected records were dropped; the rest were kept.
      expect(voss.links).toEqual({
        homeSpot: [expect.objectContaining({ name: 'The Drowned Rat' })],
        factions: [],
      });
      expect(voss.otherLinks).toEqual([]);
      expect((await readRecord(campaign, rat.payload.id)).parentId).toBe(docks.id);
    });

    it('skips an update and a link whose record was deleted, and says so', async () => {
      const campaign = await newCampaign('Deleted Since');
      const voss = await makeRecord(campaign, { type: 'npc', name: 'Captain Voss' });
      const watch = await makeRecord(campaign, { type: 'faction', name: 'Harbor Watch' });
      const mira = await makeRecord(campaign, { type: 'npc', name: 'Mira' });
      scripts = [
        (_input, ref) =>
          wire({
            updates: [
              {
                id: ref('Captain Voss'),
                fields: [field('status', 'dead')],
                addTags: [],
              },
              {
                id: ref('Mira'),
                fields: [field('status', 'alive')],
                addTags: [],
              },
            ],
            links: [
              { from: ref('Captain Voss'), to: ref('Harbor Watch'), field: 'factions', label: '' },
              { from: ref('Harbor Watch'), to: ref('Captain Voss'), field: 'leaders', label: '' },
            ],
          }),
      ];
      const detail = await runImport(campaign, {
        mode: 'add',
        text: 'Captain Voss of the Harbor Watch is dead. Mira lives.',
      });
      await call('POST', `${importsUrl(campaign)}/${detail.id}/accept-all`, gm);
      expect((await call('DELETE', `${recordsUrl(campaign)}/${voss.id}`, gm)).statusCode).toBe(204);

      // The review screen shows the record is gone.
      const reloaded = await detailOf(campaign, detail.id);
      const gone = reloaded.proposals.find(
        (p) => p.action === 'update' && p.payload.recordId === voss.id,
      );
      expect(gone?.action === 'update' && gone.before).toBeNull();
      expect(reloaded.refs[voss.id]).toBeUndefined();

      const result = await commit(campaign, detail);
      expect(result.updated).toEqual([{ id: mira.id, type: 'npc', name: 'Mira' }]);
      expect(result.linksAdded).toBe(0);
      expect(result.skipped.map((s) => s.reason)).toEqual([
        'The record has been deleted.',
        'The record has been deleted.',
        'The record it links to was left out or deleted.',
      ]);
      expect((await readRecord(campaign, watch.id)).links['leaders']).toEqual([]);
      expect((await readRecord(campaign, mira.id)).fields).toEqual({ status: 'alive' });
    });

    it('saves nothing when one proposal fails', async () => {
      const campaign = await newCampaign('Atomic');
      const voss = await makeRecord(campaign, { type: 'npc', name: 'Captain Voss' });
      scripts = [
        (_input, ref) =>
          wire({
            creates: [
              wireCreate({ id: 'N1', type: 'npc', name: 'Mira' }),
              wireCreate({ id: 'N2', type: 'item', name: 'Brass key' }),
            ],
            updates: [
              {
                id: ref('Captain Voss'),
                fields: [field('status', 'dead')],
                addTags: [],
              },
            ],
          }),
      ];
      const detail = await runImport(campaign, { mode: 'add', text: 'Captain Voss is dead.' });
      await call('POST', `${importsUrl(campaign)}/${detail.id}/accept-all`, gm);
      // Something else takes the id the second new record was promised.
      const key = createNamed(detail, 'Brass key');
      await handle.db.insert(records).values({
        id: key.payload.id,
        campaignId: campaign.id,
        type: 'lore',
        name: 'Squatter',
        publicDescription: richText(''),
        gmNotes: richText(''),
      });

      const failed = await call('POST', `${importsUrl(campaign)}/${detail.id}/commit`, gm);

      expect(failed.statusCode).toBe(500);
      // The failed query is not repeated to the browser (nor to the logs: see the last tests).
      expect(failed.json()).toEqual({
        statusCode: 500,
        error: 'Internal Server Error',
        message: 'Something went wrong on our side. Try again.',
      });
      expect(logLines.at(-2)).toContain('"dbConstraint":"records_pkey"');
      expect((await recordNames(campaign)).sort()).toEqual(['Captain Voss', 'Squatter']);
      expect((await readRecord(campaign, voss.id)).fields).toEqual({});
      expect((await detailOf(campaign, detail.id)).status).toBe('ready');
    });
  });

  describe('filling in a record', () => {
    it('retries once with the problems, then fills the record in', async () => {
      const world = await harborCampaign('Fill Campaign');
      calls.length = 0;
      scripts = [
        () => wire({ creates: [wireCreate({ id: 'N1', type: 'npc', name: 'Mira' })] }),
        (_input, ref) =>
          wire({
            updates: [
              {
                id: ref('Captain Voss'),
                fields: [
                  field('personality', 'Dour, loyal to the port.'),
                  // Already has a value: fill mode may rewrite it when the notes ask (D-34).
                  field('status', 'dead'),
                ],
                addTags: [],
              },
            ],
          }),
      ];

      const detail = await runImport(world.campaign, {
        mode: 'fill',
        text: '',
        recordId: world.voss,
      });

      expect(detail).toMatchObject({
        mode: 'fill',
        status: 'ready',
        recordId: world.voss,
        attempts: 2,
        usage: { inputTokens: 6000, outputTokens: 1600 },
        proposalCounts: { create: 0, update: 1, link: 0 },
      });
      const [update] = detail.proposals;
      // jsonb keeps no key order.
      expect(
        update?.action === 'update' && Object.keys(update.payload.fields ?? {}).sort(),
      ).toEqual(['personality', 'status']);

      expect(calls).toHaveLength(2);
      expect(calls[0]?.user.step).toMatch(/Record to fill in: E\d+\./);
      expect(calls[0]?.user.prefix).toContain('(The GM gave no notes for this request.)');
      expect(calls[1]?.retry?.previous).toEqual({
        content: [{ type: 'text', text: 'previous turn' }],
      });
      expect(calls[1]?.retry?.message).toContain('fill mode, which creates no records');
    });

    it('needs a record of this campaign', async () => {
      const campaign = await newCampaign('Fill Target');
      const elsewhere = await makeRecord(await newCampaign('Fill Elsewhere'), {
        type: 'npc',
        name: 'Stranger',
      });

      for (const recordId of [elsewhere.id, '00000000-0000-4000-8000-000000000009']) {
        const response = await call('POST', importsUrl(campaign), gm, {
          mode: 'fill',
          text: '',
          recordId,
        });
        expect(response.statusCode).toBe(404);
        expect(response.json<{ message: string }>().message).toBe('Record not found');
      }
      expect(await importRows(campaign)).toHaveLength(0);
    });
  });

  describe('when the model call fails', () => {
    let campaign: Campaign;

    beforeAll(async () => {
      campaign = await newCampaign('Failures');
    });

    const badLink: Script = () =>
      wire({
        creates: [wireCreate({ id: 'N1', type: 'npc', name: 'Mira' })],
        links: [{ from: 'N1', to: 'E99', field: 'factions', label: '' }],
      });

    it('shows the raw problems after a second bad answer, and keeps the notes', async () => {
      scripts = [badLink, badLink];

      const detail = await runImport(campaign, { mode: 'bootstrap', text: 'Mira of the Watch.' });

      expect(detail).toMatchObject({
        status: 'failed',
        attempts: 2,
        usage: { inputTokens: 6000 },
        text: 'Mira of the Watch.',
        proposals: [],
        error: {
          code: 'invalid_output',
          message: expect.stringContaining("didn't fit the record shapes") as string,
          details: [expect.stringContaining('"E99" is neither an existing record') as string],
        },
      });
      expect(detail.estimatedCostUsd).toBeGreaterThan(0);

      const commitResponse = await call('POST', `${importsUrl(campaign)}/${detail.id}/commit`, gm);
      expect(commitResponse.statusCode).toBe(409);

      // A failed import can be dismissed; dismissing twice is fine.
      for (let i = 0; i < 2; i += 1) {
        const discarded = await call('POST', `${importsUrl(campaign)}/${detail.id}/discard`, gm);
        expect(discarded.statusCode).toBe(200);
        expect(discarded.json<ImportSummary>()).toMatchObject({ status: 'discarded', error: null });
      }
    });

    it.each([
      [{ status: 'refused', model: 'claude-sonnet-5-5', usage: USAGE }, 'refused', 1, []],
      [{ status: 'truncated', model: 'claude-sonnet-5-5', usage: USAGE }, 'truncated', 1, []],
      [{ status: 'rejected' }, 'key_rejected', 0, []],
      [{ status: 'forbidden' }, 'key_forbidden', 0, []],
      [{ status: 'rate_limited' }, 'rate_limited', 0, []],
      [{ status: 'unreachable' }, 'unreachable', 0, []],
      [
        { status: 'bad_request', message: 'Credit balance too low.' },
        'bad_request',
        0,
        ['Credit balance too low.'],
      ],
    ] as const)('records %o as a failed import', async (answer, code, attempts, details) => {
      scripts = [() => answer];

      const detail = await runImport(campaign, { mode: 'bootstrap', text: 'A port town.' });

      expect(detail).toMatchObject({ status: 'failed', attempts, error: { code, details } });
      expect(detail.error?.message.length).toBeGreaterThan(20);
      expect(detail.usage.inputTokens).toBe(attempts * 3000);
      expect(await recordNames(campaign)).toEqual([]);
    });

    it('records a fault of ours without logging what went wrong', async () => {
      scripts = [() => new Error(`exploded while reading ${NOTES_MARK}`)];

      const detail = await runImport(campaign, { mode: 'bootstrap', text: 'A port town.' });

      expect(detail).toMatchObject({ status: 'failed', error: { code: 'internal', details: [] } });
      const logged = logLines.filter((line) => line.includes('ai import failed'));
      expect(logged.at(-1)).toContain('"errorName":"Error"');
      expect(logged.join('')).not.toContain('exploded');
    });

    it('discards a ready import without saving anything', async () => {
      scripts = [harbor];
      const detail = await runImport(campaign, { mode: 'bootstrap', text: 'A port town.' });
      await call('POST', `${importsUrl(campaign)}/${detail.id}/accept-all`, gm);

      const discarded = await call('POST', `${importsUrl(campaign)}/${detail.id}/discard`, gm);

      expect(discarded.json<ImportSummary>().status).toBe('discarded');
      const refused = await call('POST', `${importsUrl(campaign)}/${detail.id}/commit`, gm);
      expect(refused.statusCode).toBe(409);
      expect(refused.json<{ message: string }>().message).toContain('was discarded');
      expect(await recordNames(campaign)).toEqual([]);
      // Its proposals stay readable.
      expect((await detailOf(campaign, detail.id)).proposals).toHaveLength(4);
    });
  });

  describe('questions before records (D-30)', () => {
    const asks =
      (...questions: string[]): Script =>
      () =>
        wire({ questions });
    const mira: Script = () =>
      wire({ creates: [wireCreate({ id: 'N1', type: 'npc', name: 'Mira' })] });

    /** Starts the next step of an import and waits for it, like `runImport`. */
    async function nextStep(
      c: Campaign,
      importId: string,
      action: 'answers' | 'generate' | 'retry',
      body?: Record<string, unknown>,
    ): Promise<ImportDetail> {
      const started = await call('POST', `${importsUrl(c)}/${importId}/${action}`, gm, body);
      expect(started.statusCode, started.body).toBe(202);
      expect(started.json<ImportSummary>().status).toBe('running');
      return settle(c, importId);
    }

    it('asks first, then reads each answer before asking more or writing the records', async () => {
      const world = await harborCampaign('Questions Campaign');
      questionScripts = [
        asks('Is Mira new to the campaign?', 'Which watch did she join?'),
        asks('Is Mira paid by the Watch?'),
      ];

      let detail = await runImport(world.campaign, {
        mode: 'add',
        text: 'Mira joined the watch.',
      });

      expect(detail).toMatchObject({
        status: 'questions',
        phase: 'questions',
        steps: 1,
        questions: ['Is Mira new to the campaign?', 'Which watch did she join?'],
        conversation: [],
        proposals: [],
        usage: { inputTokens: 3000 },
      });
      expect(questionCalls.at(-1)?.user.step).toContain('phase: questions');

      detail = await nextStep(world.campaign, detail.id, 'answers', {
        answer: '  Yes, new. The Harbor Watch.  ',
      });

      expect(detail).toMatchObject({
        status: 'questions',
        steps: 2,
        questions: ['Is Mira paid by the Watch?'],
        conversation: [
          {
            questions: ['Is Mira new to the campaign?', 'Which watch did she join?'],
            answer: 'Yes, new. The Harbor Watch.',
          },
        ],
        usage: { inputTokens: 6000 },
      });
      const [earlier, latest] = questionCalls.slice(-2);
      expect(latest?.user.step).toContain('Yes, new. The Harbor Watch.');
      // The start of the message is the same each round, so Anthropic can cache it.
      expect(latest?.user.prefix).toBe(earlier?.user.prefix);

      const callsBefore = calls.length;
      scripts = [mira];
      detail = await nextStep(world.campaign, detail.id, 'generate', {
        answer: 'Yes, a little.',
      });

      expect(detail).toMatchObject({
        status: 'ready',
        phase: 'records',
        steps: 3,
        questions: [],
        proposalCounts: { create: 1, update: 0, link: 0 },
        usage: { inputTokens: 9000 },
      });
      expect(detail.conversation).toHaveLength(2);
      expect(detail.conversation[1]).toEqual({
        questions: ['Is Mira paid by the Watch?'],
        answer: 'Yes, a little.',
      });
      expect(calls).toHaveLength(callsBefore + 1);
      const records = calls.at(-1)?.user.step ?? '';
      expect(records).toContain('phase: records');
      expect(records).toContain('Yes, new. The Harbor Watch.');
      expect(records).toContain('Yes, a little.');
    });

    it('writes the records without an answer, and closes an import with nothing to save', async () => {
      const campaign = await newCampaign('Unanswered Campaign');
      questionScripts = [asks('Is it a port?')];
      const asked = await runImport(campaign, { mode: 'bootstrap', text: 'A town.' });
      scripts = [() => wire()];

      const detail = await nextStep(campaign, asked.id, 'generate', {});

      expect(detail).toMatchObject({
        status: 'ready',
        proposals: [],
        conversation: [{ questions: ['Is it a port?'], answer: null }],
      });
      expect(calls.at(-1)?.user.step).toContain('(The GM did not answer these.)');

      // The model proposed nothing: closing saves nothing, and the import is done.
      const closed = await commit(campaign, detail);
      expect(closed).toMatchObject({
        import: { status: 'committed' },
        created: [],
        updated: [],
        linksAdded: 0,
      });
      expect(await recordNames(campaign)).toEqual([]);
    });

    it('refuses a step from the wrong state, past the cap, or while another import runs', async () => {
      const campaign = await newCampaign('Step Refusals');
      questionScripts = [asks('Which town?')];
      const asked = await runImport(campaign, { mode: 'bootstrap', text: 'A town.' });
      const url = (action: string) => `${importsUrl(campaign)}/${asked.id}/${action}`;

      const blank = await call('POST', url('answers'), gm, { answer: '   ' });
      expect(blank.statusCode).toBe(400);
      const retry = await call('POST', url('retry'), gm);
      expect(retry.statusCode).toBe(409);
      expect(retry.json<{ message: string }>().message).toContain('waiting for your answers');
      const review = await call('POST', url('commit'), gm);
      expect(review.statusCode).toBe(409);
      expect(review.json<{ message: string }>().message).toContain("Answer Claude's questions");

      // Another import of the GM's is running.
      const [other] = await handle.db
        .insert(aiImports)
        .values({
          campaignId: campaign.id,
          userId: gm.id,
          mode: 'add',
          inputText: 'elsewhere',
          promptVersion: 2,
          model: 'claude-sonnet-5-5',
        })
        .returning();
      try {
        const busy = await call('POST', url('answers'), gm, { answer: 'Saltmarsh.' });
        expect(busy.statusCode).toBe(409);
        expect(busy.json<{ message: string }>().message).toContain('still running');
      } finally {
        await handle.db.delete(aiImports).where(eq(aiImports.id, other?.id ?? ''));
      }

      // Every step it may take is used up.
      await handle.db.update(aiImports).set({ steps: 10 }).where(eq(aiImports.id, asked.id));
      const capped = await call('POST', url('answers'), gm, { answer: 'Saltmarsh.' });
      expect(capped.statusCode).toBe(409);
      expect(capped.json<{ message: string }>().message).toContain('all 10 of its steps');
      expect((await detailOf(campaign, asked.id)).status).toBe('questions');

      // Discarding still works while it waits.
      const discarded = await call('POST', url('discard'), gm);
      expect(discarded.json<ImportSummary>().status).toBe('discarded');
      const late = await call('POST', url('generate'), gm, {});
      expect(late.statusCode).toBe(409);
      expect(late.json<{ message: string }>().message).toContain('was discarded');
    });

    it('tries a failed step again in its own phase, keeping the answers', async () => {
      const campaign = await newCampaign('Retry Campaign');
      questionScripts = [asks('Who leads the Watch?')];
      const asked = await runImport(campaign, { mode: 'bootstrap', text: 'A watch.' });
      scripts = [() => ({ status: 'unreachable' })];

      const failed = await nextStep(campaign, asked.id, 'generate', { answer: 'Captain Voss.' });

      expect(failed).toMatchObject({
        status: 'failed',
        phase: 'records',
        error: { code: 'unreachable' },
      });
      const ready = await call('POST', `${importsUrl(campaign)}/${asked.id}/answers`, gm, {
        answer: 'More.',
      });
      expect(ready.statusCode).toBe(409);

      scripts = [mira];
      const detail = await nextStep(campaign, asked.id, 'retry');

      expect(detail).toMatchObject({
        status: 'ready',
        phase: 'records',
        error: null,
        proposalCounts: { create: 1 },
        conversation: [{ questions: ['Who leads the Watch?'], answer: 'Captain Voss.' }],
      });
      expect(calls.at(-1)?.user.step).toContain('Captain Voss.');
      const again = await call('POST', `${importsUrl(campaign)}/${asked.id}/retry`, gm);
      expect(again.statusCode).toBe(409);
      expect(again.json<{ message: string }>().message).toContain('ready to review');
    });
  });

  describe('guardrails', () => {
    let campaign: Campaign;

    beforeAll(async () => {
      campaign = await newCampaign('Guardrails');
    });

    it('needs a stored key, and says where to add one', async () => {
      const theirs = await newCampaign('Keyless Campaign', keyless);
      const before = calls.length;

      for (const path of ['', '/estimate']) {
        const response = await call('POST', `${importsUrl(theirs)}${path}`, keyless, {
          mode: 'bootstrap',
          text: 'A port town.',
        });
        expect(response.statusCode).toBe(409);
        expect(response.json<{ message: string }>().message).toBe(
          'Add your Anthropic API key in Settings before importing.',
        );
      }
      expect(calls).toHaveLength(before);
      expect(await importRows(theirs)).toHaveLength(0);
    });

    it('refuses notes over the cap and malformed requests before any call', async () => {
      const before = calls.length;
      for (const body of [
        { mode: 'bootstrap', text: 'a'.repeat(40_001) },
        { mode: 'bootstrap', text: '   ' },
        { mode: 'add', text: 'x', targetTypes: [] },
        { mode: 'add', text: 'x', targetTypes: ['dragon'] },
        { mode: 'fill', text: '' },
        { mode: 'add', text: 'x', recordId: '00000000-0000-4000-8000-000000000009' },
        { mode: 'rewrite', text: 'x' },
        { mode: 'add', text: 'x', model: 'claude-opus-5-5' },
        {},
      ]) {
        for (const path of ['', '/estimate']) {
          const response = await call('POST', `${importsUrl(campaign)}${path}`, gm, body);
          expect(response.statusCode, JSON.stringify(body).slice(0, 80)).toBe(400);
        }
      }
      expect(calls).toHaveLength(before);
      expect(await importRows(campaign)).toHaveLength(0);
    });

    it('passes the type filter on to the model and holds the answer to it', async () => {
      scripts = [
        () => wire({ creates: [wireCreate({ id: 'N1', type: 'faction', name: 'Harbor Watch' })] }),
        () => wire({ creates: [wireCreate({ id: 'N1', type: 'npc', name: 'Mira' })] }),
      ];

      const detail = await runImport(campaign, {
        mode: 'add',
        text: 'Mira of the Watch.',
        targetTypes: ['npc'],
      });

      expect(detail).toMatchObject({ status: 'ready', attempts: 2, targetTypes: ['npc'] });
      expect(calls.at(-2)?.user.step).toContain('Create only records of these types: npc (NPC).');
      expect(calls.at(-1)?.retry?.message).toContain('allows new records only of type npc');
      await call('POST', `${importsUrl(campaign)}/${detail.id}/discard`, gm);
    });

    it('limits how many imports a GM starts in an hour', async () => {
      const filler = Array.from({ length: 20 }, () => ({
        campaignId: campaign.id,
        userId: gm.id,
        mode: 'add' as const,
        inputText: 'filler',
        promptVersion: 1,
        model: 'claude-sonnet-5-5',
        status: 'discarded' as const,
      }));
      await handle.db.insert(aiImports).values(filler);
      const before = calls.length;

      const response = await call('POST', importsUrl(campaign), gm, {
        mode: 'add',
        text: 'One more.',
      });

      expect(response.statusCode).toBe(429);
      expect(response.json<{ message: string }>().message).toContain('20 imports in the last hour');
      expect(calls).toHaveLength(before);
      await handle.db
        .delete(aiImports)
        .where(and(eq(aiImports.campaignId, campaign.id), eq(aiImports.inputText, 'filler')));
    });

    it('estimates the cost without starting anything', async () => {
      const world = await harborCampaign('Estimate Campaign');
      const rowsBefore = (await importRows(world.campaign)).length;
      const callsBefore = calls.length;
      nextCount = { status: 'ok', inputTokens: 5000 };

      const response = await call('POST', `${importsUrl(world.campaign)}/estimate`, gm, {
        mode: 'add',
        text: 'Captain Voss has gone missing.',
      });

      expect(response.statusCode, response.body).toBe(200);
      const estimate = response.json<ImportEstimateResponse>();
      expect(estimate).toMatchObject({
        model: 'claude-sonnet-5-5',
        inputTokens: 5000,
        // Voss in full; the area and the faction (his neighbours) as a line; the spot by name.
        context: { index: 1, summary: 2, full: 1 },
      });
      // 5000 tokens in, about 1500 out; and at most two calls of 32,000 out each.
      expect(estimate.estimatedCostUsd?.likely).toBeCloseTo(0.01 + 0.01517, 3);
      expect(estimate.estimatedCostUsd?.max).toBeCloseTo(2 * (0.01 + 0.32));

      // The count is of the very request an import would send.
      const counted = countCalls.at(-1);
      expect(counted?.apiKey).toBe(GM_KEY);
      expect(counted?.system).toContain('`voiceAndMannerisms`');
      expect(counted?.user.prefix).toContain('Captain Voss has gone missing.');
      expect(counted?.user.step).toContain('phase: records');
      expect(calls).toHaveLength(callsBefore);
      expect(await importRows(world.campaign)).toHaveLength(rowsBefore);
    });

    it.each([
      [{ status: 'rejected' }, 409, "didn't accept your API key"],
      [{ status: 'forbidden' }, 409, "won't let it use the API"],
      [{ status: 'rate_limited' }, 503, 'rate limiting your key'],
      [{ status: 'unreachable' }, 502, "Couldn't reach Anthropic"],
      [{ status: 'bad_request', message: 'Too large.' }, 502, 'Anthropic refused the request'],
    ] as const)('answers an estimate that got %o', async (count, status, message) => {
      nextCount = count;
      try {
        const response = await call('POST', `${importsUrl(campaign)}/estimate`, gm, {
          mode: 'add',
          text: 'A port town.',
        });
        expect(response.statusCode).toBe(status);
        expect(response.json<{ message: string }>().message).toContain(message);
      } finally {
        nextCount = { status: 'ok', inputTokens: 5000 };
      }
    });

    it('marks imports cut off by a restart as failed', async () => {
      const [orphan] = await handle.db
        .insert(aiImports)
        .values({
          campaignId: campaign.id,
          userId: keyless.id,
          mode: 'add',
          inputText: 'cut off',
          promptVersion: 1,
          model: 'claude-sonnet-5-5',
        })
        .returning();

      expect(await failInterruptedImports(handle.db)).toBe(1);
      expect(await failInterruptedImports(handle.db)).toBe(0);

      const [row] = await handle.db
        .select()
        .from(aiImports)
        .where(eq(aiImports.id, orphan?.id ?? ''));
      expect(row).toMatchObject({ status: 'failed', errorCode: 'interrupted' });
      expect(row?.finishedAt).not.toBeNull();
      expect((await detailOf(campaign, orphan?.id ?? '')).error?.message).toContain('restarted');
    });

    it("clears a GM's import that has run impossibly long, so it can't block them", async () => {
      await handle.db.insert(aiImports).values({
        campaignId: campaign.id,
        userId: gm.id,
        mode: 'add',
        inputText: 'orphaned',
        promptVersion: 1,
        model: 'claude-sonnet-5-5',
        createdAt: new Date(Date.now() - 60 * 60 * 1000),
        updatedAt: new Date(Date.now() - 60 * 60 * 1000),
      });
      scripts = [() => wire()];

      const detail = await runImport(campaign, { mode: 'add', text: 'Nothing much.' });

      // An answer with nothing in it is still a finished import.
      expect(detail).toMatchObject({ status: 'ready', proposals: [], questions: [] });
      const rows = await importRows(campaign);
      expect(rows.find((row) => row.inputText === 'orphaned')).toMatchObject({
        status: 'failed',
        errorCode: 'interrupted',
      });
    });
  });

  describe('who can do what', () => {
    let world: Awaited<ReturnType<typeof harborCampaign>>;
    let detail: ImportDetail;
    let other: Campaign;

    beforeAll(async () => {
      world = await harborCampaign('Access Campaign');
      other = await newCampaign('Other Import Campaign');
      await handle.db
        .insert(campaignMembers)
        .values({ campaignId: world.campaign.id, userId: player.id, role: 'player' });
      scripts = [() => wire({ creates: [wireCreate({ id: 'N1', type: 'npc', name: 'Mira' })] })];
      detail = await runImport(world.campaign, { mode: 'add', text: 'Mira the dockhand.' });
    });

    it("never finds an import through another campaign's address", async () => {
      const [proposal] = detail.proposals;
      if (proposal === undefined) throw new Error('no proposal');
      const through = (c: Campaign) => `${importsUrl(c)}/${detail.id}`;

      for (const [method, url, body] of [
        ['GET', through(other), undefined],
        ['POST', `${through(other)}/accept-all`, undefined],
        ['POST', `${through(other)}/commit`, undefined],
        ['POST', `${through(other)}/discard`, undefined],
        ['PATCH', `${through(other)}/proposals/${proposal.id}`, { reviewState: 'accepted' }],
        ['GET', `${importsUrl(world.campaign)}/not-a-uuid`, undefined],
      ] as const) {
        const response = await call(method, url, gm, body);
        expect(response.statusCode, url).toBe(404);
        expect(response.json<{ message: string }>().message).toBe('Import not found');
      }

      // Nor a proposal through another import of the same campaign.
      scripts = [() => wire({ creates: [wireCreate({ id: 'N1', type: 'npc', name: 'Odd' })] })];
      const second = await runImport(world.campaign, { mode: 'add', text: 'Odd.' });
      const crossed = await call(
        'PATCH',
        `${importsUrl(world.campaign)}/${second.id}/proposals/${proposal.id}`,
        gm,
        { reviewState: 'accepted' },
      );
      expect(crossed.statusCode).toBe(404);
      expect(crossed.json<{ message: string }>().message).toBe('Proposal not found');
      expect((await detailOf(world.campaign, detail.id)).proposals[0]?.reviewState).toBe('pending');
      await call('POST', `${importsUrl(world.campaign)}/${second.id}/discard`, gm);
    });

    it('keeps players out of every import route', async () => {
      const [proposal] = detail.proposals;
      const base = `${importsUrl(world.campaign)}/${detail.id}`;
      for (const [method, url, body] of [
        ['GET', importsUrl(world.campaign), undefined],
        ['GET', base, undefined],
        ['POST', importsUrl(world.campaign), { mode: 'add', text: 'x' }],
        ['POST', `${importsUrl(world.campaign)}/estimate`, { mode: 'add', text: 'x' }],
        ['PATCH', `${base}/proposals/${proposal?.id ?? ''}`, { reviewState: 'accepted' }],
        ['POST', `${base}/accept-all`, undefined],
        ['POST', `${base}/commit`, undefined],
        ['POST', `${base}/discard`, undefined],
        ['POST', `${base}/answers`, { answer: 'x' }],
        ['POST', `${base}/generate`, {}],
        ['POST', `${base}/retry`, undefined],
      ] as const) {
        const response = await call(method, url, player, body);
        expect(response.statusCode, `${method} ${url}`).toBe(403);
      }
    });

    it('is read-only while the campaign is archived', async () => {
      const [proposal] = detail.proposals;
      const base = `${importsUrl(world.campaign)}/${detail.id}`;
      await call('POST', `/api/campaigns/${world.campaign.id}/archive`, gm);
      try {
        for (const [method, url, body] of [
          ['POST', importsUrl(world.campaign), { mode: 'add', text: 'x' }],
          ['POST', `${importsUrl(world.campaign)}/estimate`, { mode: 'add', text: 'x' }],
          ['PATCH', `${base}/proposals/${proposal?.id ?? ''}`, { reviewState: 'accepted' }],
          ['POST', `${base}/accept-all`, undefined],
          ['POST', `${base}/commit`, undefined],
          ['POST', `${base}/discard`, undefined],
          ['POST', `${base}/answers`, { answer: 'x' }],
          ['POST', `${base}/generate`, {}],
          ['POST', `${base}/retry`, undefined],
        ] as const) {
          const response = await call(method, url, gm, body);
          expect(response.statusCode, `${method} ${url}`).toBe(409);
          expect(response.json<{ message: string }>().message).toBe('Campaign is archived');
        }
        expect((await call('GET', importsUrl(world.campaign), gm)).statusCode).toBe(200);
        expect((await detailOf(world.campaign, detail.id)).status).toBe('ready');
      } finally {
        await call('POST', `/api/campaigns/${world.campaign.id}/unarchive`, gm);
      }
    });

    it("shows a GM their own usage across campaigns, and nobody else's", async () => {
      const mine = await call('GET', '/api/me/usage', gm);
      expect(mine.statusCode).toBe(200);
      const usage = mine.json<UsageResponse>();
      expect(usage.imports.length).toBeGreaterThan(10);
      expect(new Set(usage.imports.map((row) => row.campaignName)).size).toBeGreaterThan(3);
      expect(usage.imports[0]).toMatchObject({
        campaignId: world.campaign.id,
        campaignName: 'Access Campaign',
        model: 'claude-sonnet-5-5',
        usage: USAGE,
      });
      expect(usage.imports[0]?.estimatedCostUsd).toBeCloseTo(0.0142);
      // Newest first.
      const times = usage.imports.map((row) => Date.parse(row.createdAt));
      expect([...times].sort((a, b) => b - a)).toEqual(times);

      const stored = await handle.db.select().from(aiImports).where(eq(aiImports.userId, gm.id));
      expect(usage.totals.imports).toBe(stored.length);
      expect(usage.totals.usage.inputTokens).toBe(
        stored.reduce((sum, row) => sum + row.inputTokens, 0),
      );
      expect(usage.totals.estimatedCostUsd).toBeGreaterThan(0.05);
      expect(JSON.stringify(usage)).not.toContain(NOTES_MARK);

      const theirs = (await call('GET', '/api/me/usage', player)).json<UsageResponse>();
      expect(theirs.imports).toEqual([]);
      expect(theirs.totals).toMatchObject({ imports: 0, estimatedCostUsd: 0 });
      expect((await call('GET', '/api/me/usage', null)).statusCode).toBe(401);
    });

    it('blocks cross-origin writes', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `${importsUrl(world.campaign)}/${detail.id}/commit`,
        headers: { origin: 'https://evil.example', cookie: gm.cookie },
      });
      expect(response.statusCode).toBe(403);
    });

    it("deletes a campaign's imports and proposals with it", async () => {
      const doomed = await newCampaign('Doomed');
      scripts = [harbor];
      const doomedImport = await runImport(doomed, { mode: 'bootstrap', text: 'A port town.' });
      await call('POST', `${importsUrl(doomed)}/${doomedImport.id}/accept-all`, gm);
      await commit(doomed, doomedImport);

      await handle.db.execute(sql`delete from campaigns where id = ${doomed.id}`);

      expect(await importRows(doomed)).toEqual([]);
      expect(
        await handle.db.select().from(aiProposals).where(eq(aiProposals.campaignId, doomed.id)),
      ).toEqual([]);
    });
  });

  describe('shutdown', () => {
    it('cancels an import in flight and records that it was interrupted', async () => {
      const campaign = await newCampaign('Shutdown');
      let started: () => void = () => undefined;
      const calling = new Promise<void>((resolve) => {
        started = resolve;
      });
      const second = await buildTestApp({
        anthropic: {
          generateImport: (input) =>
            new Promise<ImportCallResult>((resolve) => {
              started();
              input.signal?.addEventListener('abort', () => {
                resolve({ status: 'aborted' });
              });
            }),
        },
      });
      const response = await second.app.inject({
        method: 'POST',
        url: importsUrl(campaign),
        headers: { ...SAME_ORIGIN, cookie: gm.cookie },
        payload: { mode: 'bootstrap', text: 'A port town.' },
      });
      expect(response.statusCode).toBe(202);
      await calling;

      await second.app.close();

      const detail = await detailOf(campaign, response.json<ImportSummary>().id);
      expect(detail).toMatchObject({ status: 'failed', error: { code: 'interrupted' } });
    });
  });

  // Keep these two last: they scan everything the tests above produced.
  describe('privacy (§14)', () => {
    it('never writes the notes, the answer or the key to the logs', () => {
      const everything = logLines.join('');

      // The logger really ran at trace level for these requests.
      expect(everything).toContain('/imports');
      expect(logLines.length).toBeGreaterThan(100);
      for (const secret of [NOTES_MARK, ANSWER_MARK, GM_KEY, GM_KEY.slice(13, 33)]) {
        expect(everything).not.toContain(secret);
      }
      expect(everything).not.toContain('A port town');
      expect(everything).not.toContain('Captain Voss');
      expect(everything).not.toContain('Brass key');

      // And anything that does try to log them is redacted.
      const before = logLines.length;
      app.log.info(
        {
          body: { text: NOTES_MARK, payload: { name: ANSWER_MARK } },
          inputText: NOTES_MARK,
          proposal: { originalPayload: ANSWER_MARK },
        },
        'probe',
      );
      const probe = logLines.slice(before).join('');
      expect(probe).toContain('[redacted]');
      expect(probe).not.toContain(NOTES_MARK);
      expect(probe).not.toContain(ANSWER_MARK);
    });

    it('never sends the key in any response', () => {
      const everything = responseBodies.join('\n');

      expect(responseBodies.length).toBeGreaterThan(100);
      expect(everything).not.toContain(GM_KEY);
      expect(everything).not.toContain(GM_KEY.slice(13, 33));
      expect(everything).not.toMatch(/apiKey|encryptedKey|encrypted_key/);
      // The notes do come back, to the GM who wrote them.
      expect(everything).toContain(NOTES_MARK);
    });
  });
});
