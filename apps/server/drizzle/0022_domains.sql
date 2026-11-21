CREATE TYPE "public"."domain_card_type" AS ENUM('ability', 'spell', 'grimoire');--> statement-breakpoint
CREATE TABLE "domain_cards" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"domain_id" uuid NOT NULL,
	"name" text NOT NULL,
	"level" integer DEFAULT 1 NOT NULL,
	"recall_cost" integer DEFAULT 0 NOT NULL,
	"type" "domain_card_type" DEFAULT 'ability' NOT NULL,
	"feature" jsonb DEFAULT '{"type":"doc","content":[{"type":"paragraph"}]}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "domain_cards_name_length" CHECK (char_length("domain_cards"."name") between 1 and 120),
	CONSTRAINT "domain_cards_level" CHECK ("domain_cards"."level" between 1 and 10),
	CONSTRAINT "domain_cards_recall_cost" CHECK ("domain_cards"."recall_cost" between 0 and 99)
);
--> statement-breakpoint
CREATE TABLE "domains" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "domains_id_campaign_id_unique" UNIQUE("id","campaign_id"),
	CONSTRAINT "domains_name_length" CHECK (char_length("domains"."name") between 1 and 60),
	CONSTRAINT "domains_description_length" CHECK (char_length("domains"."description") <= 2000)
);
--> statement-breakpoint
ALTER TABLE "domain_cards" ADD CONSTRAINT "domain_cards_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domain_cards" ADD CONSTRAINT "domain_cards_domain_fk" FOREIGN KEY ("domain_id","campaign_id") REFERENCES "public"."domains"("id","campaign_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domains" ADD CONSTRAINT "domains_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "domain_cards_campaign_domain_idx" ON "domain_cards" USING btree ("campaign_id","domain_id");--> statement-breakpoint
CREATE UNIQUE INDEX "domains_campaign_name_idx" ON "domains" USING btree ("campaign_id",lower("name"));--> statement-breakpoint
-- The ten default domains (F4.3, 19.26) for every campaign that exists now, in the same order
-- as `DEFAULT_DOMAINS`. New campaigns get them when created (or a copy of another campaign's).
INSERT INTO "domains" ("campaign_id", "name", "description", "created_at", "updated_at")
SELECT "campaigns"."id", "defaults"."name", "defaults"."description",
  now(), now()
FROM "campaigns" CROSS JOIN (VALUES
  (0, 'Arcana', 'Arcana is the domain of innate and instinctual magic. Those who choose this path tap into the raw, enigmatic forces of the realms to manipulate both their own energy and the elements. Arcana offers wielders a volatile power, but it is incredibly potent when correctly channeled. The Arcana domain can be accessed by the Druid and Sorcerer classes.'),
  (1, 'Blade', 'Blade is the domain of weapon mastery. Whether by steel, bow, or perhaps a more specialized arm, those who follow this path have the skill to cut short the lives of others. Wielders of Blade dedicate themselves to achieving inexorable power over death. The Blade domain can be accessed by the Guardian and Warrior classes.'),
  (2, 'Bone', 'Bone is the domain of tactics and the body. Practitioners of this domain have an uncanny control over their own physical abilities and an eye for predicting the behaviors of others in combat. Adherents to Bone gain an unparalleled understanding of bodies and their movements. The Bone domain can be accessed by the Ranger & Warrior classes.'),
  (3, 'Codex', 'Codex is the domain of intensive magical study. Those who seek magical knowledge turn to the equations of power recorded in books, written on scrolls, etched into walls, or tattooed on bodies. Codex offers a commanding and versatile understanding of magic to devotees who pursue knowledge beyond the boundaries of common wisdom. The Codex domain can be accessed by the Bard and Wizard classes.'),
  (4, 'Grace', 'Grace is the domain of charisma. Through rapturous storytelling, charming spells, or a shroud of lies, those who channel this power define the realities of their adversaries, bending perception to their will. Grace offers its wielders raw magnetism and mastery over language. The Grace domain can be accessed by the Bard and Rogue classes.'),
  (5, 'Midnight', 'Midnight is the domain of shadows and secrecy. Whether by clever tricks, deft magic, or the cloak of night, those who channel these forces practice the art of obscurity and can uncover sequestered treasures. Midnight offers practitioners the power to control and create enigmas. The Midnight domain can be accessed by the Rogue and Sorcerer classes.'),
  (6, 'Sage', 'Sage is the domain of the natural world. Those who walk this path tap into the unfettered power of the earth and its creatures to unleash raw magic. Sage grants its adherents the vitality of a blooming flower and the ferocity of a ravenous predator. The Sage domain can be accessed by the Druid and Ranger classes.'),
  (7, 'Splendor', 'Splendor is the domain of life. Through this magic, followers gain the ability to heal and, to an extent, control death. Splendor offers its disciples the magnificent ability to both give and end life. The Splendor domain can be accessed by the Seraph and Wizard classes.'),
  (8, 'Valor', 'Valor is the domain of protection. Whether through attack or defense, those who choose this discipline channel formidable strength to protect their allies in battle. Valor offers great power to those who raise their shields in defense of others. The Valor domain can be accessed by the Guardian and Seraph classes.'),
  (9, 'Dread', 'Dread is the domain of nightmares and fear. Those who choose this path can call forth monstrosities, enfeeble their foes, and channel terrifying magic to destroy their enemies. Dread grants its adherents power over forces most are too afraid to employ. The Dread domain can be accessed by the Warlock and Witch classes.')
) AS "defaults" ("place", "name", "description");
