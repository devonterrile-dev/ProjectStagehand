CREATE TYPE "public"."campaign_role" AS ENUM('gm', 'player');--> statement-breakpoint
CREATE TABLE "campaign_members" (
	"campaign_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "campaign_role" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campaign_members_campaign_id_user_id_pk" PRIMARY KEY("campaign_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"gm_user_id" uuid NOT NULL,
	"ruleset_version" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campaigns_name_length" CHECK (char_length("campaigns"."name") between 1 and 80)
);
--> statement-breakpoint
ALTER TABLE "campaign_members" ADD CONSTRAINT "campaign_members_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_members" ADD CONSTRAINT "campaign_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_gm_user_id_users_id_fk" FOREIGN KEY ("gm_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "campaign_members_user_id_idx" ON "campaign_members" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_members_one_gm_idx" ON "campaign_members" USING btree ("campaign_id") WHERE "campaign_members"."role" = 'gm';--> statement-breakpoint
CREATE INDEX "campaigns_gm_user_id_idx" ON "campaigns" USING btree ("gm_user_id");