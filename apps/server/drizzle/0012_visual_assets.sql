CREATE TYPE "public"."asset_kind" AS ENUM('character', 'monster', 'prop', 'backdrop');--> statement-breakpoint
CREATE TYPE "public"."asset_status" AS ENUM('generating', 'failed', 'pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TABLE "assets" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"record_id" uuid,
	"character_id" uuid,
	"created_by" uuid NOT NULL,
	"kind" "asset_kind" NOT NULL,
	"status" "asset_status" DEFAULT 'generating' NOT NULL,
	"error_code" text,
	"prompt" text NOT NULL,
	"model" text NOT NULL,
	"style_bible_version" integer NOT NULL,
	"quality" text NOT NULL,
	"aspect_ratio" text NOT NULL,
	"revision_notes" text,
	"original_path" text,
	"processed_path" text,
	"media_type" text,
	"cost_usd" double precision,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assets_one_subject" CHECK (num_nonnulls("assets"."record_id", "assets"."character_id") <= 1),
	CONSTRAINT "assets_error_only_failed" CHECK (("assets"."status" = 'failed') = ("assets"."error_code" is not null)),
	CONSTRAINT "assets_image_once_made" CHECK ("assets"."status" in ('generating', 'failed') or "assets"."original_path" is not null)
);
--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "visual_asset_id" uuid;--> statement-breakpoint
ALTER TABLE "records" ADD COLUMN "visual_asset_id" uuid;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_record_id_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."records"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assets_record_id_created_at_idx" ON "assets" USING btree ("record_id","created_at");--> statement-breakpoint
CREATE INDEX "assets_character_id_created_at_idx" ON "assets" USING btree ("character_id","created_at");--> statement-breakpoint
CREATE INDEX "assets_created_by_created_at_idx" ON "assets" USING btree ("created_by","created_at");--> statement-breakpoint
CREATE INDEX "assets_campaign_id_idx" ON "assets" USING btree ("campaign_id");--> statement-breakpoint
ALTER TABLE "characters" ADD CONSTRAINT "characters_visual_asset_id_assets_id_fk" FOREIGN KEY ("visual_asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "records" ADD CONSTRAINT "records_visual_asset_id_assets_id_fk" FOREIGN KEY ("visual_asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;