CREATE TYPE "public"."damage_kind" AS ENUM('physical', 'magic');--> statement-breakpoint
CREATE TYPE "public"."weapon_burden" AS ENUM('one_handed', 'two_handed');--> statement-breakpoint
CREATE TYPE "public"."weapon_range" AS ENUM('melee', 'very_close', 'close', 'far', 'very_far');--> statement-breakpoint
CREATE TYPE "public"."weapon_slot" AS ENUM('primary', 'secondary');--> statement-breakpoint
CREATE TABLE "armor" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"tier" integer DEFAULT 1 NOT NULL,
	"name" text NOT NULL,
	"base_major_threshold" integer DEFAULT 0 NOT NULL,
	"base_severe_threshold" integer DEFAULT 0 NOT NULL,
	"base_score" integer DEFAULT 0 NOT NULL,
	"feature_name" text DEFAULT '' NOT NULL,
	"feature_text" text DEFAULT '' NOT NULL,
	"bonuses" jsonb DEFAULT '{"evasion":0,"armorScore":0,"majorThreshold":0,"severeThreshold":0,"traits":{}}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "armor_id_campaign_id_unique" UNIQUE("id","campaign_id"),
	CONSTRAINT "armor_name_length" CHECK (char_length("armor"."name") between 1 and 80),
	CONSTRAINT "armor_tier" CHECK ("armor"."tier" between 1 and 4),
	CONSTRAINT "armor_major_threshold" CHECK ("armor"."base_major_threshold" between 0 and 999),
	CONSTRAINT "armor_severe_threshold" CHECK ("armor"."base_severe_threshold" between 0 and 999),
	CONSTRAINT "armor_base_score" CHECK ("armor"."base_score" between 0 and 999),
	CONSTRAINT "armor_feature_name_length" CHECK (char_length("armor"."feature_name") <= 80),
	CONSTRAINT "armor_feature_text_length" CHECK (char_length("armor"."feature_text") <= 2000)
);
--> statement-breakpoint
CREATE TABLE "weapons" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"tier" integer DEFAULT 1 NOT NULL,
	"name" text NOT NULL,
	"slot" "weapon_slot" DEFAULT 'primary' NOT NULL,
	"kind" "damage_kind" DEFAULT 'physical' NOT NULL,
	"trait" text NOT NULL,
	"range" "weapon_range" DEFAULT 'melee' NOT NULL,
	"damage_die" integer DEFAULT 6 NOT NULL,
	"damage_bonus" integer DEFAULT 0 NOT NULL,
	"burden" "weapon_burden" DEFAULT 'one_handed' NOT NULL,
	"feature_name" text DEFAULT '' NOT NULL,
	"feature_text" text DEFAULT '' NOT NULL,
	"bonuses" jsonb DEFAULT '{"evasion":0,"armorScore":0,"majorThreshold":0,"severeThreshold":0,"traits":{}}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "weapons_id_campaign_id_unique" UNIQUE("id","campaign_id"),
	CONSTRAINT "weapons_name_length" CHECK (char_length("weapons"."name") between 1 and 80),
	CONSTRAINT "weapons_tier" CHECK ("weapons"."tier" between 1 and 4),
	CONSTRAINT "weapons_damage_die" CHECK ("weapons"."damage_die" in (4, 6, 8, 10, 12, 20)),
	CONSTRAINT "weapons_damage_bonus" CHECK ("weapons"."damage_bonus" between -99 and 99),
	CONSTRAINT "weapons_secondary_one_handed" CHECK ("weapons"."slot" = 'primary' or "weapons"."burden" = 'one_handed'),
	CONSTRAINT "weapons_feature_name_length" CHECK (char_length("weapons"."feature_name") <= 80),
	CONSTRAINT "weapons_feature_text_length" CHECK (char_length("weapons"."feature_text") <= 2000)
);
--> statement-breakpoint
ALTER TABLE "armor" ADD CONSTRAINT "armor_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weapons" ADD CONSTRAINT "weapons_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "armor_campaign_tier_idx" ON "armor" USING btree ("campaign_id","tier");--> statement-breakpoint
CREATE INDEX "weapons_campaign_tier_idx" ON "weapons" USING btree ("campaign_id","tier");