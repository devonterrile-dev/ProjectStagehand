/**
 * Migration 0011 (F1.10, D-41): points of interest become hidden Prop records linked to their
 * Spot, a point of interest that is already an Item at that place stays only an Item (its
 * detail joins the Item's GM notes), and old AI import proposals lose the key.
 *
 * Runs on a scratch database: migrated up to 0010, seeded with pre-F1.10 rows, then migrated
 * the rest of the way with the real runner, all in one transaction as in production.
 */
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { fieldsSchemaFor, recordTypeSchema } from '@stagehand/shared';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { MIGRATIONS_FOLDER, runMigrations } from './migrate';

const testUrl = inject('databaseUrl');
const scratchName = `${new URL(testUrl).pathname.slice(1)}_m0011`;
const scratchUrl = (() => {
  const url = new URL(testUrl);
  url.pathname = `/${scratchName}`;
  return url.toString();
})();

const doc = (text: string) => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
});
const EMPTY = { type: 'doc', content: [{ type: 'paragraph' }] };

/** The migrations folder without 0011 and later, so the database stops at 0010. */
function foldersUpTo0010(): string {
  const dir = mkdtempSync(join(tmpdir(), 'stagehand-m0011-'));
  cpSync(MIGRATIONS_FOLDER, dir, { recursive: true });
  const journalPath = join(dir, 'meta', '_journal.json');
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
    entries: { idx: number; tag: string }[];
  };
  for (const entry of journal.entries.filter((e) => e.idx >= 11)) {
    rmSync(join(dir, `${entry.tag}.sql`));
  }
  journal.entries = journal.entries.filter((entry) => entry.idx < 11);
  writeFileSync(journalPath, JSON.stringify(journal));
  return dir;
}

describe('migration 0011: points of interest become Props', () => {
  let admin: pg.Client;
  let db: pg.Client;
  let oldFolder: string;
  const ids: Record<string, string> = {};

  async function insertRecord(
    key: string,
    values: { campaign: string; type: string; name: string; parentId?: string } & Record<
      string,
      unknown
    >,
  ) {
    const result = await db.query<{ id: string }>(
      `insert into records (campaign_id, type, name, public_description, gm_notes, fields, parent_id, tags, source)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id`,
      [
        values.campaign,
        values.type,
        values.name,
        JSON.stringify(EMPTY),
        JSON.stringify(values['gmNotes'] ?? EMPTY),
        JSON.stringify(values['fields'] ?? {}),
        values.parentId ?? null,
        values['tags'] ?? [],
        values['source'] ?? 'manual',
      ],
    );
    ids[key] = result.rows[0]?.id ?? '';
    return ids[key];
  }

  async function link(campaign: string, from: string, to: string, fieldKey: string) {
    await db.query(
      `insert into record_links (campaign_id, from_record_id, to_record_id, kind, field_key)
       values ($1, $2, $3, 'field', $4)`,
      [campaign, from, to, fieldKey],
    );
  }

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: testUrl });
    await admin.connect();
    await admin.query(`drop database if exists ${scratchName} with (force)`);
    await admin.query(`create database ${scratchName}`);

    oldFolder = foldersUpTo0010();
    await runMigrations(scratchUrl, oldFolder);
    db = new pg.Client({ connectionString: scratchUrl });
    await db.connect();

    const user = await db.query<{ id: string }>(
      `insert into users (name, email, discord_id, discord_username)
       values ('GM', 'gm@example.test', '110001', 'gm') returning id`,
    );
    const userId = user.rows[0]?.id ?? '';
    const campaign = await db.query<{ id: string }>(
      `insert into campaigns (name, gm_user_id) values ('Utopia', $1) returning id`,
      [userId],
    );
    const c = campaign.rows[0]?.id ?? '';
    ids['campaign'] = c;

    const beach = await insertRecord('beach', {
      campaign: c,
      type: 'area',
      name: 'Southern Beach',
    });
    await insertRecord('shore', {
      campaign: c,
      type: 'spot',
      name: 'Shore',
      parentId: beach,
      tags: ['coast'],
      source: 'ai_import',
      fields: {
        readAloud: doc('Waves.'),
        pointsOfInterest: [
          { name: 'Discarded trunk', detail: 'Holds   the orb.' },
          { name: 'Shipwreck', detail: 'A mile\ndown the beach.' },
          { name: 'Driftwood sign', detail: '' },
          { name: '  ', detail: 'Nameless, dropped.' },
        ],
      },
    });
    await insertRecord('cave', {
      campaign: c,
      type: 'spot',
      name: 'Cave',
      parentId: beach,
      fields: { pointsOfInterest: [{ name: 'Lantern', detail: 'Still lit.' }] },
    });
    // The Item the trunk point of interest really is: held by the Spot's Area.
    const trunk = await insertRecord('trunk', {
      campaign: c,
      type: 'item',
      name: 'The Trunk',
      gmNotes: doc('Found cracked open.'),
    });
    await link(c, trunk, beach, 'currentHolder');
    // An Item of the same name somewhere else is not the cave's lantern.
    await insertRecord('lantern', { campaign: c, type: 'item', name: 'Lantern' });

    const runImport = await db.query<{ id: string }>(
      `insert into ai_imports (campaign_id, user_id, mode, status, input_text, prompt_version, model)
       values ($1, $2, 'add', 'ready', 'notes', 4, 'claude-sonnet-5-5') returning id`,
      [c, userId],
    );
    const payload = {
      id: '00000000-0000-4000-8000-0000000000aa',
      type: 'spot',
      name: 'Dock',
      parentId: beach,
      tags: [],
      fields: { readAloud: doc('Planks.'), pointsOfInterest: [{ name: 'Bell', detail: '' }] },
      links: {},
      otherLinks: [],
    };
    await db.query(
      `insert into ai_proposals (import_id, campaign_id, position, action, payload, original_payload)
       values ($1, $2, 0, 'create', $3, $3)`,
      [runImport.rows[0]?.id, c, JSON.stringify(payload)],
    );

    // The rest of the way, through the real runner (one transaction).
    const result = await runMigrations(scratchUrl);
    expect(result.applied).toBeGreaterThanOrEqual(1);
  });

  afterAll(async () => {
    await db.end();
    await admin.query(`drop database if exists ${scratchName} with (force)`);
    await admin.end();
    rmSync(oldFolder, { recursive: true, force: true });
  });

  async function propsAt(spotId: string) {
    const result = await db.query<{
      name: string;
      fields: Record<string, unknown>;
      revealed_at: Date | null;
      tags: string[];
      source: string;
    }>(
      `select p.name, p.fields, p.revealed_at, p.tags, p.source from records p
       join record_links l on l.from_record_id = p.id and l.kind = 'field' and l.field_key = 'spot'
       where p.type = 'prop' and l.to_record_id = $1 order by p.name`,
      [spotId],
    );
    return result.rows;
  }

  it("makes each other point of interest a hidden Prop at its Spot, keeping the Spot's tags", async () => {
    const shore = await propsAt(ids['shore'] ?? '');
    expect(shore.map((prop) => prop.name)).toEqual(['Driftwood sign', 'Shipwreck']);
    for (const prop of shore) {
      expect(prop.revealed_at).toBeNull();
      expect(prop.tags).toEqual(['coast']);
      expect(prop.source).toBe('ai_import');
    }
    expect(shore[0]?.fields).toEqual({});
    expect(shore[1]?.fields).toEqual({ hiddenDetails: doc('A mile down the beach.') });
    // The cave's lantern is not the Item of that name, which is at no place.
    expect((await propsAt(ids['cave'] ?? '')).map((prop) => prop.name)).toEqual(['Lantern']);
  });

  it('keeps an Item at that place as the Item, adding the detail to its GM notes', async () => {
    const trunk = await db.query<{ gm_notes: unknown }>(
      'select gm_notes from records where id = $1',
      [ids['trunk']],
    );
    expect(trunk.rows[0]?.gm_notes).toEqual({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Found cracked open.' }] },
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Point of interest at Shore: Holds the orb.' }],
        },
      ],
    });
    const props = await db.query(
      "select 1 from records where type = 'prop' and name ilike '%trunk%'",
    );
    expect(props.rowCount).toBe(0);
  });

  it('leaves no point of interest anywhere, and every record still parses', async () => {
    const left = await db.query("select 1 from records where fields ? 'pointsOfInterest'");
    expect(left.rowCount).toBe(0);
    const proposals = await db.query<{ payload: { fields: Record<string, unknown> } }>(
      'select payload, original_payload from ai_proposals',
    );
    expect(proposals.rows[0]?.payload.fields).toEqual({ readAloud: doc('Planks.') });
    expect(JSON.stringify(proposals.rows)).not.toContain('pointsOfInterest');

    const records = await db.query<{ type: string; name: string; fields: Record<string, unknown> }>(
      'select type, name, fields from records',
    );
    // Every read checks `fields` against its type's schema, so all of them must pass.
    for (const row of records.rows) {
      const type = recordTypeSchema.parse(row.type);
      expect(fieldsSchemaFor(type).safeParse(row.fields).success, row.name).toBe(true);
    }
  });

  it('rebuilt the type enum with prop, keeping its checks and index', async () => {
    const values = await db.query<{ value: string }>(
      'select unnest(enum_range(null::record_type))::text as value',
    );
    expect(values.rows.map((row) => row.value)).toEqual([
      'npc',
      'area',
      'spot',
      'prop',
      'faction',
      'lore',
      'story_beat',
      'item',
      'session_notes',
    ]);
    const constraints = await db.query<{ conname: string }>(
      "select conname from pg_constraint where conrelid = 'records'::regclass and contype = 'c' order by conname",
    );
    expect(constraints.rows.map((row) => row.conname)).toEqual(
      expect.arrayContaining(['records_parent_only_spots', 'records_stat_block_only_npcs']),
    );
    // The parent check still holds: a Prop can't have an Area.
    await expect(
      db.query(
        `insert into records (campaign_id, type, name, public_description, gm_notes, parent_id)
         values ($1, 'prop', 'Bad', '{}', '{}', $2)`,
        [ids['campaign'], ids['beach']],
      ),
    ).rejects.toThrow(/records_parent_only_spots/);
    const index = await db.query(
      "select 1 from pg_indexes where indexname = 'records_campaign_id_type_idx'",
    );
    expect(index.rowCount).toBe(1);
  });
});
