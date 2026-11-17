CREATE TABLE "player_entries" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"author_user_id" uuid,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "player_entries_id_campaign_id_unique" UNIQUE("id","campaign_id"),
	CONSTRAINT "player_entries_title_length" CHECK (char_length("player_entries"."title") between 1 and 120),
	CONSTRAINT "player_entries_description_length" CHECK (char_length("player_entries"."description") <= 4000)
);
--> statement-breakpoint
CREATE TABLE "player_notes" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"record_id" uuid,
	"entry_id" uuid,
	"author_user_id" uuid,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "player_notes_one_subject" CHECK (("player_notes"."record_id" is null) <> ("player_notes"."entry_id" is null)),
	CONSTRAINT "player_notes_body_length" CHECK (char_length("player_notes"."body") between 1 and 500)
);
--> statement-breakpoint
ALTER TABLE "records" ADD COLUMN "public_search_vector" "tsvector" GENERATED ALWAYS AS (public.stagehand_record_search_vector(name, NULL, public_description, NULL)) STORED;--> statement-breakpoint
ALTER TABLE "player_entries" ADD CONSTRAINT "player_entries_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_entries" ADD CONSTRAINT "player_entries_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_notes" ADD CONSTRAINT "player_notes_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_notes" ADD CONSTRAINT "player_notes_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_notes" ADD CONSTRAINT "player_notes_record_fk" FOREIGN KEY ("record_id","campaign_id") REFERENCES "public"."records"("id","campaign_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_notes" ADD CONSTRAINT "player_notes_entry_fk" FOREIGN KEY ("entry_id","campaign_id") REFERENCES "public"."player_entries"("id","campaign_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "player_entries_campaign_id_idx" ON "player_entries" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "player_entries_author_user_id_idx" ON "player_entries" USING btree ("author_user_id");--> statement-breakpoint
CREATE INDEX "player_notes_record_created_idx" ON "player_notes" USING btree ("record_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "player_notes_entry_created_idx" ON "player_notes" USING btree ("entry_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "player_notes_campaign_id_idx" ON "player_notes" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "player_notes_author_user_id_idx" ON "player_notes" USING btree ("author_user_id");--> statement-breakpoint
CREATE INDEX "records_public_search_vector_idx" ON "records" USING gin ("public_search_vector");