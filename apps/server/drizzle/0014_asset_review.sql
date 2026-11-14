-- F2.5 (D-44): review. A record or PC keeps one image in use and at most a draft or two under
-- review; a discarded try keeps its row as `rejected` (for the hourly limit and its cost) but
-- loses its files, so a rejected row may have no original any more.
--
-- The schema part is drizzle-kit's. The tidy below is hand-written: F2.3 kept every try, so
-- each owner keeps the image in use and its newest unused finished try (now its draft), and
-- every other try is discarded. Only rows change here; the server's startup sweep
-- (`purgeDiscarded`) deletes the discarded files, which SQL can't reach.
ALTER TABLE "assets" DROP CONSTRAINT "assets_image_once_made";--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "revised_from_id" uuid;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_revised_from_id_assets_id_fk" FOREIGN KEY ("revised_from_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_image_once_made" CHECK ("assets"."status" in ('generating', 'failed', 'rejected') or "assets"."original_path" is not null);--> statement-breakpoint
-- The image in use is approved (it always was; this only makes sure).
UPDATE "assets" SET "status" = 'approved'
WHERE "status" = 'pending'
  AND ("id" IN (SELECT "visual_asset_id" FROM "records" WHERE "visual_asset_id" IS NOT NULL)
    OR "id" IN (SELECT "visual_asset_id" FROM "characters" WHERE "visual_asset_id" IS NOT NULL));--> statement-breakpoint
-- A try once used and since swapped out. An approved try whose record or PC was deleted stays,
-- for the asset library (F2.7).
UPDATE "assets" SET "status" = 'rejected'
WHERE "status" = 'approved'
  AND ("record_id" IS NOT NULL OR "character_id" IS NOT NULL)
  AND "id" NOT IN (SELECT "visual_asset_id" FROM "records" WHERE "visual_asset_id" IS NOT NULL)
  AND "id" NOT IN (SELECT "visual_asset_id" FROM "characters" WHERE "visual_asset_id" IS NOT NULL);--> statement-breakpoint
-- Failed tries have no files; they are dismissed (`assets_error_only_failed` clears the code).
UPDATE "assets" SET "status" = 'rejected', "error_code" = NULL WHERE "status" = 'failed';--> statement-breakpoint
-- Finished tries whose record or PC is gone, and every finished try but the newest per owner.
UPDATE "assets" SET "status" = 'rejected'
WHERE "status" = 'pending' AND "record_id" IS NULL AND "character_id" IS NULL;--> statement-breakpoint
UPDATE "assets" SET "status" = 'rejected'
WHERE "id" IN (
  SELECT "id" FROM (
    SELECT "id", row_number() OVER (
      PARTITION BY "record_id", "character_id" ORDER BY "created_at" DESC, "id" DESC
    ) AS "n"
    FROM "assets"
    WHERE "status" = 'pending'
  ) AS "ranked"
  WHERE "n" > 1
);
