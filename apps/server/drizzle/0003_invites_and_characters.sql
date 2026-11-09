CREATE TABLE "characters" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "characters_id_campaign_id_unique" UNIQUE("id","campaign_id"),
	CONSTRAINT "characters_name_length" CHECK (char_length("characters"."name") between 1 and 80)
);
--> statement-breakpoint
CREATE TABLE "invites" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"code" text NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invites_code_unique" UNIQUE("code")
);
--> statement-breakpoint
ALTER TABLE "campaign_members" ADD COLUMN "character_id" uuid;--> statement-breakpoint
ALTER TABLE "characters" ADD CONSTRAINT "characters_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "characters_campaign_id_idx" ON "characters" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "invites_campaign_id_idx" ON "invites" USING btree ("campaign_id");--> statement-breakpoint
ALTER TABLE "campaign_members" ADD CONSTRAINT "campaign_members_character_fk" FOREIGN KEY ("character_id","campaign_id") REFERENCES "public"."characters"("id","campaign_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_members_character_id_idx" ON "campaign_members" USING btree ("character_id");--> statement-breakpoint
ALTER TABLE "campaign_members" ADD CONSTRAINT "campaign_members_pc_players_only" CHECK ("campaign_members"."role" = 'player' or "campaign_members"."character_id" is null);