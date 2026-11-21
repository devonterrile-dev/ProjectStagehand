CREATE TYPE "public"."card_place" AS ENUM('loadout', 'vault');--> statement-breakpoint
ALTER TYPE "public"."session_event_kind" ADD VALUE 'rest';--> statement-breakpoint
ALTER TYPE "public"."session_event_kind" ADD VALUE 'card_recall';--> statement-breakpoint
CREATE TABLE "character_domain_cards" (
	"character_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"card_id" uuid NOT NULL,
	"place" "card_place" NOT NULL,
	"taken_at_level" integer NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "character_domain_cards_character_id_card_id_pk" PRIMARY KEY("character_id","card_id"),
	CONSTRAINT "character_domain_cards_level" CHECK ("character_domain_cards"."taken_at_level" >= 1)
);
--> statement-breakpoint
CREATE TABLE "character_weapons" (
	"character_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"weapon_id" uuid NOT NULL,
	CONSTRAINT "character_weapons_character_id_position_pk" PRIMARY KEY("character_id","position"),
	CONSTRAINT "character_weapons_position" CHECK ("character_weapons"."position" >= 0)
);
--> statement-breakpoint
ALTER TABLE "characters" DROP CONSTRAINT "characters_armor_slots_marked_max";--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "class_id" uuid;--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "subclass_id" uuid;--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "subclass_cards" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "species1_id" uuid;--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "species2_id" uuid;--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "primary_weapon_id" uuid;--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "secondary_weapon_id" uuid;--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "armor_id" uuid;--> statement-breakpoint
ALTER TABLE "play_sessions" ADD COLUMN "rest" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "domain_cards" ADD CONSTRAINT "domain_cards_id_campaign_id_unique" UNIQUE("id","campaign_id");--> statement-breakpoint
ALTER TABLE "character_domain_cards" ADD CONSTRAINT "character_domain_cards_character_fk" FOREIGN KEY ("character_id","campaign_id") REFERENCES "public"."characters"("id","campaign_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_domain_cards" ADD CONSTRAINT "character_domain_cards_card_fk" FOREIGN KEY ("card_id","campaign_id") REFERENCES "public"."domain_cards"("id","campaign_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_weapons" ADD CONSTRAINT "character_weapons_character_fk" FOREIGN KEY ("character_id","campaign_id") REFERENCES "public"."characters"("id","campaign_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_weapons" ADD CONSTRAINT "character_weapons_weapon_fk" FOREIGN KEY ("weapon_id","campaign_id") REFERENCES "public"."weapons"("id","campaign_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "character_domain_cards_campaign_card_idx" ON "character_domain_cards" USING btree ("campaign_id","card_id");--> statement-breakpoint
CREATE INDEX "character_weapons_campaign_weapon_idx" ON "character_weapons" USING btree ("campaign_id","weapon_id");--> statement-breakpoint
ALTER TABLE "characters" ADD CONSTRAINT "characters_class_fk" FOREIGN KEY ("class_id","campaign_id") REFERENCES "public"."classes"("id","campaign_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "characters" ADD CONSTRAINT "characters_subclass_fk" FOREIGN KEY ("subclass_id","campaign_id") REFERENCES "public"."subclasses"("id","campaign_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "characters" ADD CONSTRAINT "characters_species1_fk" FOREIGN KEY ("species1_id","campaign_id") REFERENCES "public"."species"("id","campaign_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "characters" ADD CONSTRAINT "characters_species2_fk" FOREIGN KEY ("species2_id","campaign_id") REFERENCES "public"."species"("id","campaign_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "characters" ADD CONSTRAINT "characters_primary_weapon_fk" FOREIGN KEY ("primary_weapon_id","campaign_id") REFERENCES "public"."weapons"("id","campaign_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "characters" ADD CONSTRAINT "characters_secondary_weapon_fk" FOREIGN KEY ("secondary_weapon_id","campaign_id") REFERENCES "public"."weapons"("id","campaign_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "characters" ADD CONSTRAINT "characters_armor_fk" FOREIGN KEY ("armor_id","campaign_id") REFERENCES "public"."armor"("id","campaign_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "characters" ADD CONSTRAINT "characters_subclass_cards" CHECK ("characters"."subclass_cards" between 0 and 3);--> statement-breakpoint
ALTER TABLE "characters" ADD CONSTRAINT "characters_subclass_needs_class" CHECK ("characters"."subclass_id" is null or "characters"."class_id" is not null);--> statement-breakpoint
ALTER TABLE "characters" ADD CONSTRAINT "characters_species_pair" CHECK ("characters"."species2_id" is null or ("characters"."species1_id" is not null and "characters"."species1_id" <> "characters"."species2_id"));