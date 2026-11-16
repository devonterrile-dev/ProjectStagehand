-- F3.4 (D-52): the control desk. All drizzle-kit's.
-- A live object is a record or, added live, a PC's puppet; a session's log of scene loads and
-- reveals is kept when the session ends.
CREATE TYPE "public"."session_event_kind" AS ENUM('scene_load', 'reveal', 'unreveal');--> statement-breakpoint
CREATE TABLE "session_events" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"play_session_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"kind" "session_event_kind" NOT NULL,
	"actor_user_id" uuid,
	"record_id" uuid,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "play_session_objects" ALTER COLUMN "record_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "play_session_objects" ADD COLUMN "character_id" uuid;--> statement-breakpoint
ALTER TABLE "session_events" ADD CONSTRAINT "session_events_play_session_id_play_sessions_id_fk" FOREIGN KEY ("play_session_id") REFERENCES "public"."play_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_events" ADD CONSTRAINT "session_events_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_events" ADD CONSTRAINT "session_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_events" ADD CONSTRAINT "session_events_record_id_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."records"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "session_events_session_at_idx" ON "session_events" USING btree ("play_session_id","at");--> statement-breakpoint
CREATE INDEX "session_events_campaign_id_idx" ON "session_events" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "session_events_actor_user_id_idx" ON "session_events" USING btree ("actor_user_id");--> statement-breakpoint
CREATE INDEX "session_events_record_id_idx" ON "session_events" USING btree ("record_id");--> statement-breakpoint
ALTER TABLE "play_session_objects" ADD CONSTRAINT "play_session_objects_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "play_session_objects_character_id_idx" ON "play_session_objects" USING btree ("character_id");--> statement-breakpoint
CREATE UNIQUE INDEX "play_session_objects_npc_unique" ON "play_session_objects" USING btree ("play_session_id","record_id") WHERE "play_session_objects"."kind" = 'puppet' and "play_session_objects"."record_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "play_session_objects_pc_unique" ON "play_session_objects" USING btree ("play_session_id","character_id") WHERE "play_session_objects"."character_id" is not null;--> statement-breakpoint
ALTER TABLE "play_session_objects" ADD CONSTRAINT "play_session_objects_one_subject" CHECK (("play_session_objects"."record_id" is null) <> ("play_session_objects"."character_id" is null));--> statement-breakpoint
ALTER TABLE "play_session_objects" ADD CONSTRAINT "play_session_objects_pc_is_puppet" CHECK ("play_session_objects"."character_id" is null or "play_session_objects"."kind" = 'puppet');