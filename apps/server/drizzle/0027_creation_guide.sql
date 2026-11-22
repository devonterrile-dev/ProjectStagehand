CREATE TYPE "public"."starting_gear_mode" AS ENUM('default', 'set', 'none');--> statement-breakpoint
CREATE TABLE "starting_kits" (
	"campaign_id" uuid PRIMARY KEY NOT NULL,
	"mode" "starting_gear_mode" DEFAULT 'default' NOT NULL,
	"primary_weapon_id" uuid,
	"secondary_weapon_id" uuid,
	"armor_id" uuid,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"gold" jsonb DEFAULT '{"handfuls":0,"bags":0,"chests":0}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "needs_guide" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "built_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "starting_kits" ADD CONSTRAINT "starting_kits_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "starting_kits" ADD CONSTRAINT "starting_kits_primary_weapon_fk" FOREIGN KEY ("primary_weapon_id","campaign_id") REFERENCES "public"."weapons"("id","campaign_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "starting_kits" ADD CONSTRAINT "starting_kits_secondary_weapon_fk" FOREIGN KEY ("secondary_weapon_id","campaign_id") REFERENCES "public"."weapons"("id","campaign_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "starting_kits" ADD CONSTRAINT "starting_kits_armor_fk" FOREIGN KEY ("armor_id","campaign_id") REFERENCES "public"."armor"("id","campaign_id") ON DELETE no action ON UPDATE no action;