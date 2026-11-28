CREATE TYPE "public"."battle_size" AS ENUM('small', 'medium', 'large');--> statement-breakpoint
ALTER TYPE "public"."session_event_kind" ADD VALUE 'battle_start';--> statement-breakpoint
ALTER TYPE "public"."session_event_kind" ADD VALUE 'battle_end';--> statement-breakpoint
CREATE TABLE "play_battle_tokens" (
	"play_session_id" uuid NOT NULL,
	"object_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"column" integer,
	"row" integer,
	CONSTRAINT "play_battle_tokens_play_session_id_object_id_pk" PRIMARY KEY("play_session_id","object_id"),
	CONSTRAINT "play_battle_tokens_square" CHECK (("play_battle_tokens"."column" is null) = ("play_battle_tokens"."row" is null) and ("play_battle_tokens"."column" is null or ("play_battle_tokens"."column" between 0 and 17 and "play_battle_tokens"."row" between 0 and 17)))
);
--> statement-breakpoint
ALTER TABLE "play_sessions" ADD COLUMN "battle_size" "battle_size";--> statement-breakpoint
ALTER TABLE "play_battle_tokens" ADD CONSTRAINT "play_battle_tokens_play_session_id_play_sessions_id_fk" FOREIGN KEY ("play_session_id") REFERENCES "public"."play_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "play_battle_tokens" ADD CONSTRAINT "play_battle_tokens_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "play_battle_tokens" ADD CONSTRAINT "play_battle_tokens_object_fk" FOREIGN KEY ("play_session_id","object_id") REFERENCES "public"."play_session_objects"("play_session_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "play_battle_tokens_campaign_id_idx" ON "play_battle_tokens" USING btree ("campaign_id");--> statement-breakpoint
CREATE UNIQUE INDEX "play_battle_tokens_square_unique" ON "play_battle_tokens" USING btree ("play_session_id","column","row");