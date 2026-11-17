-- F3.6 (D-54): rolls, Hope and Fear. All drizzle-kit's. Nothing here uses the new
-- session_event_kind values, so adding them inside the migration's transaction is safe (D-41).
ALTER TYPE "public"."session_event_kind" ADD VALUE 'roll';--> statement-breakpoint
ALTER TYPE "public"."session_event_kind" ADD VALUE 'roll_reveal';--> statement-breakpoint
ALTER TYPE "public"."session_event_kind" ADD VALUE 'fear_spend';--> statement-breakpoint
ALTER TYPE "public"."session_event_kind" ADD VALUE 'fear_adjust';--> statement-breakpoint
ALTER TYPE "public"."session_event_kind" ADD VALUE 'hope_adjust';--> statement-breakpoint
CREATE TABLE "play_roll_calls" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"play_session_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"character_id" uuid NOT NULL,
	"trait" text NOT NULL,
	"difficulty" integer NOT NULL,
	"difficulty_hidden" boolean NOT NULL,
	"label" text,
	"called_by" uuid,
	"called_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "play_roll_calls_difficulty" CHECK ("play_roll_calls"."difficulty" between 1 and 99),
	CONSTRAINT "play_roll_calls_label_length" CHECK ("play_roll_calls"."label" is null or char_length("play_roll_calls"."label") between 1 and 80)
);
--> statement-breakpoint
ALTER TABLE "play_roll_calls" ADD CONSTRAINT "play_roll_calls_play_session_id_play_sessions_id_fk" FOREIGN KEY ("play_session_id") REFERENCES "public"."play_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "play_roll_calls" ADD CONSTRAINT "play_roll_calls_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "play_roll_calls" ADD CONSTRAINT "play_roll_calls_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "play_roll_calls" ADD CONSTRAINT "play_roll_calls_called_by_users_id_fk" FOREIGN KEY ("called_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "play_roll_calls_session_character_unique" ON "play_roll_calls" USING btree ("play_session_id","character_id");--> statement-breakpoint
CREATE INDEX "play_roll_calls_campaign_id_idx" ON "play_roll_calls" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "play_roll_calls_character_id_idx" ON "play_roll_calls" USING btree ("character_id");--> statement-breakpoint
CREATE INDEX "play_roll_calls_called_by_idx" ON "play_roll_calls" USING btree ("called_by");--> statement-breakpoint
CREATE INDEX "session_events_session_kind_at_idx" ON "session_events" USING btree ("play_session_id","kind","at");