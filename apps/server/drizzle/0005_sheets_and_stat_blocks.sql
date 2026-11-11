CREATE TABLE "stat_blocks" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"name" text NOT NULL,
	"tier" integer DEFAULT 1 NOT NULL,
	"role" text DEFAULT '' NOT NULL,
	"public_description" jsonb DEFAULT '{"type":"doc","content":[{"type":"paragraph"}]}'::jsonb NOT NULL,
	"difficulty" integer DEFAULT 0 NOT NULL,
	"attack_modifier" integer DEFAULT 0 NOT NULL,
	"standard_attack" jsonb,
	"experiences" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"motives" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"features" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"major_threshold" integer DEFAULT 0 NOT NULL,
	"severe_threshold" integer DEFAULT 0 NOT NULL,
	"hp_max" integer DEFAULT 0 NOT NULL,
	"stress_max" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stat_blocks_id_campaign_id_unique" UNIQUE("id","campaign_id"),
	CONSTRAINT "stat_blocks_name_length" CHECK (char_length("stat_blocks"."name") between 1 and 120),
	CONSTRAINT "stat_blocks_role_length" CHECK (char_length("stat_blocks"."role") <= 80),
	CONSTRAINT "stat_blocks_tier_min" CHECK ("stat_blocks"."tier" >= 1),
	CONSTRAINT "stat_blocks_numbers_nonnegative" CHECK (least("stat_blocks"."difficulty", "stat_blocks"."major_threshold", "stat_blocks"."severe_threshold", "stat_blocks"."hp_max", "stat_blocks"."stress_max") >= 0)
);
--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "level" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "class_name" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "public_description" jsonb DEFAULT '{"type":"doc","content":[{"type":"paragraph"}]}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "gm_notes" jsonb DEFAULT '{"type":"doc","content":[{"type":"paragraph"}]}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "traits" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "evasion" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "armor_score" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "armor_slots_max" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "armor_slots_marked" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "minor_threshold" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "major_threshold" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "severe_threshold" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "hp_max" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "hp_current" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "stress_max" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "stress_current" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "hope" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "proficiency" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "experiences" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "weapons" jsonb DEFAULT '{"primary":null,"secondary":null,"inventory":[]}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "armor" jsonb;--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "inventory" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "gold" jsonb DEFAULT '{"handfuls":0,"bags":0,"chests":0}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "class_feature" jsonb;--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "combat_options" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "records" ADD COLUMN "stat_block_id" uuid;--> statement-breakpoint
ALTER TABLE "stat_blocks" ADD CONSTRAINT "stat_blocks_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "stat_blocks_campaign_id_idx" ON "stat_blocks" USING btree ("campaign_id");--> statement-breakpoint
ALTER TABLE "records" ADD CONSTRAINT "records_stat_block_fk" FOREIGN KEY ("stat_block_id","campaign_id") REFERENCES "public"."stat_blocks"("id","campaign_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "records_stat_block_id_idx" ON "records" USING btree ("stat_block_id");--> statement-breakpoint
ALTER TABLE "characters" ADD CONSTRAINT "characters_class_name_length" CHECK (char_length("characters"."class_name") <= 80);--> statement-breakpoint
ALTER TABLE "characters" ADD CONSTRAINT "characters_level_min" CHECK ("characters"."level" >= 1);--> statement-breakpoint
ALTER TABLE "characters" ADD CONSTRAINT "characters_numbers_nonnegative" CHECK (least("characters"."evasion", "characters"."armor_score", "characters"."armor_slots_max", "characters"."armor_slots_marked", "characters"."minor_threshold", "characters"."major_threshold", "characters"."severe_threshold", "characters"."hp_max", "characters"."hp_current", "characters"."stress_max", "characters"."stress_current", "characters"."hope", "characters"."proficiency") >= 0);--> statement-breakpoint
ALTER TABLE "characters" ADD CONSTRAINT "characters_hp_current_max" CHECK ("characters"."hp_current" <= "characters"."hp_max");--> statement-breakpoint
ALTER TABLE "characters" ADD CONSTRAINT "characters_stress_current_max" CHECK ("characters"."stress_current" <= "characters"."stress_max");--> statement-breakpoint
ALTER TABLE "characters" ADD CONSTRAINT "characters_armor_slots_marked_max" CHECK ("characters"."armor_slots_marked" <= "characters"."armor_slots_max");--> statement-breakpoint
ALTER TABLE "records" ADD CONSTRAINT "records_stat_block_only_npcs" CHECK ("records"."type" = 'npc' or "records"."stat_block_id" is null);