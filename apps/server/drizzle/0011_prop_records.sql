-- F1.10 (D-37, D-41): Prop records replace a Spot's points of interest.
--
-- Hand-written. drizzle-kit generates `ALTER TYPE ... ADD VALUE 'prop'`, but every pending
-- migration runs in one transaction and Postgres refuses to use a value added there before
-- it commits, so the enum is rebuilt instead: a new type created in this transaction can be
-- used at once. The two checks and the index that read `type` are dropped and recreated
-- around the column change, exactly as 0004 and 0005 defined them.
ALTER TABLE "records" DROP CONSTRAINT "records_parent_only_spots";--> statement-breakpoint
ALTER TABLE "records" DROP CONSTRAINT "records_stat_block_only_npcs";--> statement-breakpoint
DROP INDEX "records_campaign_id_type_idx";--> statement-breakpoint
ALTER TYPE "public"."record_type" RENAME TO "record_type_pre_0011";--> statement-breakpoint
CREATE TYPE "public"."record_type" AS ENUM('npc', 'area', 'spot', 'prop', 'faction', 'lore', 'story_beat', 'item', 'session_notes');--> statement-breakpoint
ALTER TABLE "records" ALTER COLUMN "type" SET DATA TYPE "public"."record_type" USING "type"::text::"public"."record_type";--> statement-breakpoint
DROP TYPE "public"."record_type_pre_0011";--> statement-breakpoint
ALTER TABLE "records" ADD CONSTRAINT "records_parent_only_spots" CHECK (("records"."type" = 'spot') = ("records"."parent_id" is not null));--> statement-breakpoint
ALTER TABLE "records" ADD CONSTRAINT "records_stat_block_only_npcs" CHECK ("records"."type" = 'npc' or "records"."stat_block_id" is null);--> statement-breakpoint
CREATE INDEX "records_campaign_id_type_idx" ON "records" USING btree ("campaign_id","type");--> statement-breakpoint
-- Every point of interest with a name, one row each. `item_id` is set when the same thing is
-- already an Item at that place: something the party can carry stays an Item (D-33), so no
-- Prop is made. "At that place" means linked from the Spot's "Items here", or having the
-- Spot or its Area as current holder. "The same thing" compares names without a leading
-- "the", "a" or "an", and also counts one name holding the other as whole words: the
-- "Discarded trunk" point of interest is the Item "The Trunk".
-- Details were single-line plain text; runs of whitespace become one space.
CREATE FUNCTION pg_temp.poi_0011_core(name text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT regexp_replace(lower(btrim(regexp_replace(name, '\s+', ' ', 'g'))), '^(the|a|an) ', '')
$$;--> statement-breakpoint
CREATE FUNCTION pg_temp.poi_0011_same(a text, b text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT pg_temp.poi_0011_core(a) <> '' AND pg_temp.poi_0011_core(b) <> '' AND (
    strpos(' ' || pg_temp.poi_0011_core(a) || ' ', ' ' || pg_temp.poi_0011_core(b) || ' ') > 0
    OR strpos(' ' || pg_temp.poi_0011_core(b) || ' ', ' ' || pg_temp.poi_0011_core(a) || ' ') > 0
  )
$$;--> statement-breakpoint
CREATE TEMPORARY TABLE "poi_0011" ON COMMIT DROP AS
SELECT
  pg_catalog.gen_random_uuid() AS "prop_id",
  s."id" AS "spot_id",
  s."campaign_id",
  s."name" AS "spot_name",
  s."tags",
  s."source",
  s."ai_import_id",
  e."position",
  left(btrim(e."value"->>'name'), 120) AS "name",
  btrim(regexp_replace(coalesce(e."value"->>'detail', ''), '\s+', ' ', 'g')) AS "detail",
  (
    SELECT i."id"
    FROM "records" i
    WHERE i."campaign_id" = s."campaign_id"
      AND i."type" = 'item'
      AND pg_temp.poi_0011_same(i."name", e."value"->>'name')
      AND (
        EXISTS (
          SELECT 1 FROM "record_links" l
          WHERE l."kind" = 'field' AND l."field_key" = 'itemsHere'
            AND l."from_record_id" = s."id" AND l."to_record_id" = i."id"
        )
        OR EXISTS (
          SELECT 1 FROM "record_links" l
          WHERE l."kind" = 'field' AND l."field_key" = 'currentHolder'
            AND l."from_record_id" = i."id" AND l."to_record_id" IN (s."id", s."parent_id")
        )
      )
    -- The closest name first: an exact match beats a containing one.
    ORDER BY (pg_temp.poi_0011_core(i."name") = pg_temp.poi_0011_core(e."value"->>'name')) DESC, i."created_at"
    LIMIT 1
  ) AS "item_id"
FROM "records" s
CROSS JOIN LATERAL jsonb_array_elements(s."fields"->'pointsOfInterest') WITH ORDINALITY AS e("value", "position")
WHERE s."type" = 'spot'
  AND jsonb_typeof(s."fields"->'pointsOfInterest') = 'array'
  AND btrim(coalesce(e."value"->>'name', '')) <> '';--> statement-breakpoint
-- A point of interest that is also an Item: its detail goes to the end of the Item's GM notes.
UPDATE "records" r
SET "gm_notes" = jsonb_set(r."gm_notes", '{content}', coalesce(r."gm_notes"->'content', '[]'::jsonb) || notes."paragraphs"),
    "updated_at" = now()
FROM (
  SELECT
    "item_id",
    jsonb_agg(
      jsonb_build_object(
        'type', 'paragraph',
        'content', jsonb_build_array(jsonb_build_object(
          'type', 'text',
          'text', 'Point of interest at ' || "spot_name" || CASE WHEN "detail" = '' THEN '.' ELSE ': ' || "detail" END
        ))
      )
      ORDER BY "spot_name", "position"
    ) AS "paragraphs"
  FROM "poi_0011"
  WHERE "item_id" IS NOT NULL
  GROUP BY "item_id"
) notes
WHERE r."id" = notes."item_id";--> statement-breakpoint
-- Every other point of interest becomes a hidden Prop: its name, its detail as hidden details,
-- and the Spot's tags, source and import.
INSERT INTO "records" ("id", "campaign_id", "type", "name", "public_description", "gm_notes", "fields", "tags", "source", "ai_import_id")
SELECT
  "prop_id",
  "campaign_id",
  'prop',
  "name",
  '{"type":"doc","content":[{"type":"paragraph"}]}'::jsonb,
  '{"type":"doc","content":[{"type":"paragraph"}]}'::jsonb,
  CASE WHEN "detail" = '' THEN '{}'::jsonb ELSE jsonb_build_object(
    'hiddenDetails', jsonb_build_object(
      'type', 'doc',
      'content', jsonb_build_array(jsonb_build_object(
        'type', 'paragraph',
        'content', jsonb_build_array(jsonb_build_object('type', 'text', 'text', "detail"))
      ))
    )
  ) END,
  "tags",
  "source",
  "ai_import_id"
FROM "poi_0011"
WHERE "item_id" IS NULL;--> statement-breakpoint
-- Each new Prop's one Spot link: the only stored side of a Spot's "Props here".
INSERT INTO "record_links" ("campaign_id", "from_record_id", "to_record_id", "kind", "field_key")
SELECT "campaign_id", "prop_id", "spot_id", 'field', 'spot'
FROM "poi_0011"
WHERE "item_id" IS NULL;--> statement-breakpoint
UPDATE "records" SET "fields" = "fields" - 'pointsOfInterest' WHERE "fields" ? 'pointsOfInterest';--> statement-breakpoint
-- AI import proposals made before F1.10 may carry points of interest; without the key they
-- still parse, so old imports can be opened and pending ones reviewed.
UPDATE "ai_proposals"
SET "payload" = jsonb_set("payload", '{fields}', ("payload"->'fields') - 'pointsOfInterest')
WHERE jsonb_typeof("payload"->'fields') = 'object' AND ("payload"->'fields') ? 'pointsOfInterest';--> statement-breakpoint
UPDATE "ai_proposals"
SET "original_payload" = jsonb_set("original_payload", '{fields}', ("original_payload"->'fields') - 'pointsOfInterest')
WHERE jsonb_typeof("original_payload"->'fields') = 'object' AND ("original_payload"->'fields') ? 'pointsOfInterest';
