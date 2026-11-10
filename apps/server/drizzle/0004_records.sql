CREATE TYPE "public"."record_source" AS ENUM('manual', 'ai_import');--> statement-breakpoint
CREATE TYPE "public"."record_type" AS ENUM('npc', 'area', 'spot', 'faction', 'lore', 'story_beat', 'item', 'session_notes');--> statement-breakpoint
CREATE TABLE "records" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"type" "record_type" NOT NULL,
	"name" text NOT NULL,
	"public_description" jsonb NOT NULL,
	"gm_notes" jsonb NOT NULL,
	"fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"parent_id" uuid,
	"revealed_at" timestamp with time zone,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"source" "record_source" DEFAULT 'manual' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "records_id_campaign_id_unique" UNIQUE("id","campaign_id"),
	CONSTRAINT "records_parent_only_spots" CHECK (("records"."type" = 'spot') = ("records"."parent_id" is not null)),
	CONSTRAINT "records_name_length" CHECK (char_length("records"."name") between 1 and 120)
);
--> statement-breakpoint
ALTER TABLE "records" ADD CONSTRAINT "records_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "records" ADD CONSTRAINT "records_parent_fk" FOREIGN KEY ("parent_id","campaign_id") REFERENCES "public"."records"("id","campaign_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "records_campaign_id_type_idx" ON "records" USING btree ("campaign_id","type");--> statement-breakpoint
CREATE INDEX "records_parent_id_idx" ON "records" USING btree ("parent_id");