import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadStyleBible } from '@stagehand/style-bible';
import { afterAll, describe, expect, it, vi } from 'vitest';

import type { ImageCallInput, OpenRouterProvider } from '../../src/providers/openrouter';

import {
  contactSheetHtml,
  IMAGE_COST_GUESS_USD,
  measuredCosts,
  quoteUsd,
  runSamples,
  sampleJobs,
  type RunInfo,
  type RunRecord,
} from './run';
import { TEST_SET } from './test-set';

const bible = loadStyleBible();
const temp = mkdtempSync(join(tmpdir(), 'stagehand-style-sample-'));
afterAll(() => {
  rmSync(temp, { recursive: true, force: true });
});

const INFO: RunInfo = {
  startedAt: '2026-11-13T12:00:00.000Z',
  model: 'openai/gpt-image-2',
  styleBibleVersion: bible.version,
  references: { prop: ['prop-well.webp'], monster: ['monster-troll.webp'] },
  reps: 2,
};

describe('the test set', () => {
  it('has the fixed 10 subjects with unique ids, covering every kind', () => {
    expect(TEST_SET).toHaveLength(10);
    expect(new Set(TEST_SET.map((subject) => subject.id)).size).toBe(10);
    expect(new Set(TEST_SET.map((subject) => subject.kind))).toEqual(
      new Set(['character', 'monster', 'prop', 'backdrop']),
    );
  });

  it('builds a prompt for every subject from the style bible', () => {
    const jobs = sampleJobs(bible, TEST_SET, 2);
    expect(jobs).toHaveLength(20);
    expect(jobs.map((job) => job.rep).slice(0, 4)).toEqual([1, 2, 1, 2]);
    for (const job of jobs) {
      expect(job.prompt.startsWith(bible.base)).toBe(true);
      expect(job.prompt).toContain(`Name: ${job.subject.name}`);
    }
  });
});

describe('quoteUsd', () => {
  const jobs = sampleJobs(bible, TEST_SET, 1);

  it('uses the guess per quality when nothing was measured', () => {
    expect(quoteUsd(bible, jobs)).toBeCloseTo(10 * IMAGE_COST_GUESS_USD.medium);
  });

  it('uses what the last run measured per kind', () => {
    const measured = measuredCosts([
      { kind: 'prop', status: 'ok', costUsd: 0.1 },
      { kind: 'prop', status: 'ok', costUsd: 0.2 },
      { kind: 'prop', status: 'failed', costUsd: null },
      { kind: 'backdrop', status: 'ok', costUsd: null },
    ] as RunRecord['results']);
    expect(measured).toEqual({ prop: expect.closeTo(0.15) as unknown });
    // 3 props at 0.15, the other 7 at the guess.
    expect(quoteUsd(bible, jobs, measured)).toBeCloseTo(0.45 + 7 * IMAGE_COST_GUESS_USD.medium);
  });
});

describe('runSamples', () => {
  it('draws every job with its kind settings and writes images, run.json and the contact sheet', async () => {
    const outDir = mkdtempSync(join(temp, 'run-'));
    const calls: ImageCallInput[] = [];
    const provider: Pick<OpenRouterProvider, 'generateImage'> = {
      generateImage: vi.fn((input: ImageCallInput) => {
        calls.push(input);
        if (input.prompt.includes('Name: Cave Spider')) {
          return Promise.resolve({ status: 'bad_request' as const, message: 'safety <system>' });
        }
        return Promise.resolve({
          status: 'ok' as const,
          image: Buffer.from(input.prompt.slice(-20)),
          mediaType: 'image/png',
          costUsd: 0.05,
        });
      }),
    };
    const subjects = TEST_SET.filter((subject) =>
      ['monster-cave-spider', 'prop-well', 'backdrop-forest-path'].includes(subject.id),
    );
    const propAnchor = { data: Buffer.from('prop anchor'), mediaType: 'image/webp' };
    const monsterAnchor = { data: Buffer.from('monster anchor'), mediaType: 'image/webp' };
    const seen: string[] = [];
    let clock = 0;

    const record = await runSamples({
      provider,
      apiKey: 'sk-or-test',
      bible,
      jobs: sampleJobs(bible, subjects, 2),
      references: { prop: [propAnchor], monster: [monsterAnchor] },
      info: INFO,
      outDir,
      concurrency: 2,
      onResult: (result) => seen.push(`${result.id}#${String(result.rep)}`),
      now: () => (clock += 1500),
    });

    expect(calls).toHaveLength(6);
    for (const call of calls) {
      expect(call.apiKey).toBe('sk-or-test');
      expect(call.model).toBe(INFO.model);
    }
    // Each kind gets only its own anchors (D-39); a kind without anchors gets none.
    const referencesOf = (name: string) =>
      calls.find((call) => call.prompt.includes(`Name: ${name}`))?.references;
    expect(referencesOf('Village Well')).toEqual([propAnchor]);
    expect(referencesOf('Cave Spider')).toEqual([monsterAnchor]);
    expect(referencesOf('Forest Path')).toEqual([]);
    const backdrop = calls.find((call) => call.prompt.includes('Name: Forest Path'));
    expect(backdrop).toMatchObject({ aspectRatio: '16:9', quality: 'medium' });
    expect(calls.find((call) => call.prompt.includes('Name: Village Well'))).toMatchObject({
      aspectRatio: '1:1',
    });

    expect(seen).toHaveLength(6);
    // Results keep job order whatever order they finished in.
    expect(record.results.map((result) => `${result.id}#${String(result.rep)}`)).toEqual([
      'monster-cave-spider#1',
      'monster-cave-spider#2',
      'prop-well#1',
      'prop-well#2',
      'backdrop-forest-path#1',
      'backdrop-forest-path#2',
    ]);
    expect(record.totalCostUsd).toBeCloseTo(0.2);
    expect(record.results[0]).toMatchObject({
      status: 'bad_request',
      file: null,
      costUsd: null,
      message: 'safety <system>',
    });
    expect(record.results[2]).toMatchObject({
      status: 'ok',
      file: 'prop-well-r1.png',
    });

    // Each call is timed on its own; the fake clock ticks 1.5 s per reading.
    for (const result of record.results) expect(result.seconds).toBeGreaterThan(0);
    expect(existsSync(join(outDir, 'prop-well-r1.png'))).toBe(true);
    expect(existsSync(join(outDir, 'monster-cave-spider-r1.png'))).toBe(false);
    const saved = JSON.parse(readFileSync(join(outDir, 'run.json'), 'utf8')) as RunRecord;
    expect(saved.results).toHaveLength(6);
    expect(saved.references).toEqual(INFO.references);
    const html = readFileSync(join(outDir, 'index.html'), 'utf8');
    expect(html).toContain('<img src="prop-well-r2.png"');
    expect(html).toContain('safety &lt;system&gt;');
    expect(html).not.toContain('sk-or-test');
  });
});

describe('runSamples retries', () => {
  it('tries a rate-limited call once more, and only once', async () => {
    const outDir = mkdtempSync(join(temp, 'retry-'));
    const answers = ['rate_limited', 'ok', 'rate_limited', 'rate_limited'] as const;
    let calls = 0;
    const provider: Pick<OpenRouterProvider, 'generateImage'> = {
      generateImage: () => {
        const status = answers[calls++] ?? 'failed';
        return Promise.resolve(
          status === 'ok'
            ? { status, image: Buffer.from('png'), mediaType: 'image/png', costUsd: 0.04 }
            : { status },
        );
      },
    };
    const subjects = TEST_SET.filter((subject) =>
      ['prop-well', 'item-lantern'].includes(subject.id),
    );

    const record = await runSamples({
      provider,
      apiKey: 'sk-or-test',
      bible,
      jobs: sampleJobs(bible, subjects, 1),
      references: {},
      info: INFO,
      outDir,
      concurrency: 1,
      rateLimitPauseMs: 1,
    });

    expect(calls).toBe(4);
    expect(record.results.map((result) => result.status)).toEqual(['ok', 'rate_limited']);
  });
});

describe('contactSheetHtml', () => {
  it('escapes record text and shows the run settings', () => {
    const html = contactSheetHtml({
      ...INFO,
      totalCostUsd: 0.1,
      results: [
        {
          id: 'x',
          kind: 'prop',
          source: 'Prop record',
          name: 'A <b>bold</b> "thing"',
          rep: 1,
          prompt: 'Draw <script>',
          status: 'ok',
          file: 'x-r1.png',
          costUsd: 0.1,
          seconds: 3,
          message: null,
        },
      ],
    });
    expect(html).toContain('A &lt;b&gt;bold&lt;/b&gt; &quot;thing&quot;');
    expect(html).toContain('Draw &lt;script&gt;');
    expect(html).toContain('references: monster: monster-troll.webp; prop: prop-well.webp');
    expect(html).toContain('total $0.100');
    expect(html).not.toContain('<h2>backdrop</h2>');
  });
});
