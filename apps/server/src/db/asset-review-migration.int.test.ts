/**
 * Migration 0014 (F2.5, D-44): a record keeps its image in use and its newest unused finished
 * try (its draft); every other try is discarded (`rejected`), failed ones lose their error
 * code, and an approved image whose record was deleted stays for the asset library. Files are
 * left for the startup sweep, so discarded rows keep their paths here.
 *
 * Runs on a scratch database: migrated up to 0013, seeded with F2.3-style tries, then
 * migrated the rest of the way with the real runner.
 */
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { MIGRATIONS_FOLDER, runMigrations } from './migrate';

const testUrl = inject('databaseUrl');
const scratchName = `${new URL(testUrl).pathname.slice(1)}_m0014`;
const scratchUrl = (() => {
  const url = new URL(testUrl);
  url.pathname = `/${scratchName}`;
  return url.toString();
})();

const EMPTY = { type: 'doc', content: [{ type: 'paragraph' }] };

/** The migrations folder without 0014 and later, so the database stops at 0013. */
function foldersUpTo0013(): string {
  const dir = mkdtempSync(join(tmpdir(), 'stagehand-m0014-'));
  cpSync(MIGRATIONS_FOLDER, dir, { recursive: true });
  const journalPath = join(dir, 'meta', '_journal.json');
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
    entries: { idx: number; tag: string }[];
  };
  for (const entry of journal.entries.filter((e) => e.idx >= 14)) {
    rmSync(join(dir, `${entry.tag}.sql`));
  }
  journal.entries = journal.entries.filter((entry) => entry.idx < 14);
  writeFileSync(journalPath, JSON.stringify(journal));
  return dir;
}

describe('migration 0014: one image in use and one draft per record', () => {
  let admin: pg.Client;
  let db: pg.Client;
  let oldFolder: string;
  let campaign = '';
  let gm = '';
  const ids: Record<string, string> = {};

  async function insertRecord(key: string, name: string): Promise<string> {
    const result = await db.query<{ id: string }>(
      `insert into records (campaign_id, type, name, public_description, gm_notes, fields)
       values ($1, 'prop', $2, $3, $3, '{}') returning id`,
      [campaign, name, JSON.stringify(EMPTY)],
    );
    ids[key] = result.rows[0]?.id ?? '';
    return ids[key];
  }

  /** One try, `minutesAgo` old, with an original file unless it failed or is generating. */
  async function insertAsset(
    key: string,
    recordId: string | null,
    status: string,
    minutesAgo: number,
  ): Promise<string> {
    const made = status !== 'failed' && status !== 'generating';
    const result = await db.query<{ id: string }>(
      `insert into assets (campaign_id, record_id, created_by, kind, status, error_code, prompt,
         model, style_bible_version, quality, aspect_ratio, original_path, created_at)
       values ($1, $2, $3, 'prop', $4, $5, 'seeded', 'openai/gpt-image-2', 1, 'medium', '1:1',
         $6, now() - make_interval(mins => $7)) returning id`,
      [
        campaign,
        recordId,
        gm,
        status,
        status === 'failed' ? 'failed' : null,
        made ? `campaigns/${campaign}/${key}.png` : null,
        minutesAgo,
      ],
    );
    ids[key] = result.rows[0]?.id ?? '';
    return ids[key];
  }

  async function use(recordId: string, assetId: string) {
    await db.query('update records set visual_asset_id = $2 where id = $1', [recordId, assetId]);
  }

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: testUrl });
    await admin.connect();
    await admin.query(`drop database if exists ${scratchName} with (force)`);
    await admin.query(`create database ${scratchName}`);

    oldFolder = foldersUpTo0013();
    await runMigrations(scratchUrl, oldFolder);
    db = new pg.Client({ connectionString: scratchUrl });
    await db.connect();

    const user = await db.query<{ id: string }>(
      `insert into users (name, email, discord_id, discord_username)
       values ('GM', 'gm@example.test', '140001', 'gm') returning id`,
    );
    gm = user.rows[0]?.id ?? '';
    const created = await db.query<{ id: string }>(
      `insert into campaigns (name, gm_user_id) values ('Painted Coast', $1) returning id`,
      [gm],
    );
    campaign = created.rows[0]?.id ?? '';

    // A bell with five tries: one in use, one used before it, two unused, one failed.
    const bell = await insertRecord('bell', 'Harbour Bell');
    await insertAsset('bellUsedBefore', bell, 'approved', 60);
    await insertAsset('bellInUse', bell, 'approved', 50);
    await insertAsset('bellOlder', bell, 'pending', 40);
    await insertAsset('bellNewest', bell, 'pending', 30);
    await insertAsset('bellFailed', bell, 'failed', 20);
    await use(bell, ids['bellInUse'] ?? '');

    // A lamp never used: only its newest finished try stays.
    const lamp = await insertRecord('lamp', 'Lamp Post');
    await insertAsset('lampOld', lamp, 'pending', 45);
    await insertAsset('lampNew', lamp, 'pending', 35);
    await insertAsset('lampGenerating', lamp, 'generating', 1);

    // A kettle whose image in use was somehow still pending.
    const kettle = await insertRecord('kettle', 'Copper Kettle');
    await insertAsset('kettleInUse', kettle, 'pending', 25);
    await use(kettle, ids['kettleInUse'] ?? '');

    // Tries of a deleted record: the image it used stays, its drafts go.
    await insertAsset('orphanApproved', null, 'approved', 70);
    await insertAsset('orphanPending', null, 'pending', 65);

    await runMigrations(scratchUrl);
  });

  afterAll(async () => {
    await db.end();
    await admin.query(`drop database if exists ${scratchName} with (force)`);
    await admin.end();
    rmSync(oldFolder, { recursive: true, force: true });
  });

  async function statusOf(key: string) {
    const result = await db.query<{
      status: string;
      error_code: string | null;
      original_path: string | null;
      revised_from_id: string | null;
    }>('select status, error_code, original_path, revised_from_id from assets where id = $1', [
      ids[key],
    ]);
    return result.rows[0];
  }

  it('keeps the image in use and the newest unused try of a record, and discards the rest', async () => {
    expect((await statusOf('bellInUse'))?.status).toBe('approved');
    expect((await statusOf('bellNewest'))?.status).toBe('pending');
    for (const key of ['bellUsedBefore', 'bellOlder']) {
      expect(await statusOf(key), key).toMatchObject({
        status: 'rejected',
        // The startup sweep deletes the file and clears this.
        original_path: `campaigns/${campaign}/${key}.png`,
      });
    }
    expect(await statusOf('bellFailed')).toMatchObject({ status: 'rejected', error_code: null });
  });

  it('keeps the newest finished try of a record with nothing in use, and a running one', async () => {
    expect((await statusOf('lampOld'))?.status).toBe('rejected');
    expect((await statusOf('lampNew'))?.status).toBe('pending');
    expect((await statusOf('lampGenerating'))?.status).toBe('generating');
  });

  it('marks the image in use approved', async () => {
    expect((await statusOf('kettleInUse'))?.status).toBe('approved');
  });

  it("keeps a deleted record's image for the asset library and discards its draft", async () => {
    expect((await statusOf('orphanApproved'))?.status).toBe('approved');
    expect((await statusOf('orphanPending'))?.status).toBe('rejected');
  });

  it('adds revised_from_id and lets a discarded try have no file', async () => {
    expect((await statusOf('bellNewest'))?.revised_from_id).toBeNull();
    await db.query('update assets set original_path = null, revised_from_id = $2 where id = $1', [
      ids['bellOlder'],
      ids['bellInUse'],
    ]);
    await expect(
      db.query('update assets set original_path = null where id = $1', [ids['bellNewest']]),
    ).rejects.toThrow(/assets_image_once_made/);
  });
});
