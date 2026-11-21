CREATE TABLE "species" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"features" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "species_id_campaign_id_unique" UNIQUE("id","campaign_id"),
	CONSTRAINT "species_name_length" CHECK (char_length("species"."name") between 1 and 80),
	CONSTRAINT "species_description_length" CHECK (char_length("species"."description") <= 2000)
);
--> statement-breakpoint
ALTER TABLE "species" ADD CONSTRAINT "species_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "species_campaign_name_idx" ON "species" USING btree ("campaign_id",lower("name"));