CREATE TYPE "public"."paint_color" AS ENUM('red', 'orange', 'yellow', 'green', 'blue', 'black');--> statement-breakpoint
CREATE TYPE "public"."paint_size" AS ENUM('fine', 'medium', 'broad');--> statement-breakpoint
CREATE TYPE "public"."paint_tool" AS ENUM('paint', 'erase');--> statement-breakpoint
CREATE TABLE "play_battle_strokes" (
	"play_session_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"tool" "paint_tool" NOT NULL,
	"color" "paint_color",
	"size" "paint_size" NOT NULL,
	"points" jsonb NOT NULL,
	CONSTRAINT "play_battle_strokes_play_session_id_id_pk" PRIMARY KEY("play_session_id","id"),
	CONSTRAINT "play_battle_strokes_color" CHECK (("play_battle_strokes"."tool" = 'paint') = ("play_battle_strokes"."color" is not null)),
	CONSTRAINT "play_battle_strokes_position" CHECK ("play_battle_strokes"."position" >= 0)
);
--> statement-breakpoint
ALTER TABLE "play_battle_strokes" ADD CONSTRAINT "play_battle_strokes_play_session_id_play_sessions_id_fk" FOREIGN KEY ("play_session_id") REFERENCES "public"."play_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "play_battle_strokes" ADD CONSTRAINT "play_battle_strokes_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "play_battle_strokes_session_position_idx" ON "play_battle_strokes" USING btree ("play_session_id","position");--> statement-breakpoint
CREATE INDEX "play_battle_strokes_campaign_id_idx" ON "play_battle_strokes" USING btree ("campaign_id");