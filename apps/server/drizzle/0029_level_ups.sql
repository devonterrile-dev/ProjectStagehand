ALTER TYPE "public"."session_event_kind" ADD VALUE 'level_up';--> statement-breakpoint
CREATE TABLE "character_level_ups" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"character_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"level" integer NOT NULL,
	"picks" jsonb NOT NULL,
	"cards" jsonb NOT NULL,
	"before" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "character_level_ups_level" CHECK ("character_level_ups"."level" >= 2)
);
--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "level_up_granted" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "character_level_ups" ADD CONSTRAINT "character_level_ups_character_fk" FOREIGN KEY ("character_id","campaign_id") REFERENCES "public"."characters"("id","campaign_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "character_level_ups_character_level_idx" ON "character_level_ups" USING btree ("character_id","level");