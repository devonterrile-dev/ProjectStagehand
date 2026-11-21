CREATE TABLE "classes" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"domain1_id" uuid,
	"domain2_id" uuid,
	"starting_evasion" integer DEFAULT 10 NOT NULL,
	"starting_hp" integer DEFAULT 6 NOT NULL,
	"hope_feature" jsonb DEFAULT '{"name":"","cost":3,"text":""}'::jsonb NOT NULL,
	"class_features" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"suggested_traits" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"suggested_primary_weapon_id" uuid,
	"suggested_secondary_weapon_id" uuid,
	"suggested_armor_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "classes_id_campaign_id_unique" UNIQUE("id","campaign_id"),
	CONSTRAINT "classes_name_length" CHECK (char_length("classes"."name") between 1 and 80),
	CONSTRAINT "classes_description_length" CHECK (char_length("classes"."description") <= 2000),
	CONSTRAINT "classes_two_domains" CHECK ("classes"."domain1_id" <> "classes"."domain2_id"),
	CONSTRAINT "classes_starting_evasion" CHECK ("classes"."starting_evasion" between 0 and 999),
	CONSTRAINT "classes_starting_hp" CHECK ("classes"."starting_hp" between 0 and 999)
);
--> statement-breakpoint
CREATE TABLE "subclasses" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"class_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"spellcast_trait" text,
	"foundation" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"specialization" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"mastery" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subclasses_id_campaign_id_unique" UNIQUE("id","campaign_id"),
	CONSTRAINT "subclasses_name_length" CHECK (char_length("subclasses"."name") between 1 and 80),
	CONSTRAINT "subclasses_description_length" CHECK (char_length("subclasses"."description") <= 2000)
);
--> statement-breakpoint
ALTER TABLE "classes" ADD CONSTRAINT "classes_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "classes" ADD CONSTRAINT "classes_domain1_fk" FOREIGN KEY ("domain1_id","campaign_id") REFERENCES "public"."domains"("id","campaign_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "classes" ADD CONSTRAINT "classes_domain2_fk" FOREIGN KEY ("domain2_id","campaign_id") REFERENCES "public"."domains"("id","campaign_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "classes" ADD CONSTRAINT "classes_suggested_primary_fk" FOREIGN KEY ("suggested_primary_weapon_id","campaign_id") REFERENCES "public"."weapons"("id","campaign_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "classes" ADD CONSTRAINT "classes_suggested_secondary_fk" FOREIGN KEY ("suggested_secondary_weapon_id","campaign_id") REFERENCES "public"."weapons"("id","campaign_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "classes" ADD CONSTRAINT "classes_suggested_armor_fk" FOREIGN KEY ("suggested_armor_id","campaign_id") REFERENCES "public"."armor"("id","campaign_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subclasses" ADD CONSTRAINT "subclasses_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subclasses" ADD CONSTRAINT "subclasses_class_fk" FOREIGN KEY ("class_id","campaign_id") REFERENCES "public"."classes"("id","campaign_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "classes_campaign_name_idx" ON "classes" USING btree ("campaign_id",lower("name"));--> statement-breakpoint
CREATE INDEX "subclasses_campaign_class_idx" ON "subclasses" USING btree ("campaign_id","class_id");