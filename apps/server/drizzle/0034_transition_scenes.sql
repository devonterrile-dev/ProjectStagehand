CREATE TYPE "public"."travel_mode" AS ENUM('walking', 'stationary');--> statement-breakpoint
ALTER TABLE "play_session_objects" ADD COLUMN "travel_mode" "travel_mode";--> statement-breakpoint
ALTER TABLE "play_session_objects" ADD COLUMN "pass_from" double precision;--> statement-breakpoint
ALTER TABLE "play_sessions" ADD COLUMN "transition" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "play_sessions" ADD COLUMN "travel_distance" double precision DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "play_sessions" ADD COLUMN "travel_since" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "scene_objects" ADD COLUMN "travel_mode" "travel_mode";--> statement-breakpoint
ALTER TABLE "scenes" DROP COLUMN "type";--> statement-breakpoint
UPDATE "scene_objects" SET "travel_mode" = 'walking' WHERE "kind" = 'puppet';--> statement-breakpoint
UPDATE "play_session_objects" SET "travel_mode" = 'walking' WHERE "kind" = 'puppet' AND "record_id" IS NOT NULL;--> statement-breakpoint
DROP TYPE "public"."scene_type";--> statement-breakpoint
ALTER TABLE "play_session_objects" ADD CONSTRAINT "play_session_objects_travel_mode_only_npcs" CHECK (("play_session_objects"."kind" = 'puppet' and "play_session_objects"."record_id" is not null) = ("play_session_objects"."travel_mode" is not null));--> statement-breakpoint
ALTER TABLE "play_session_objects" ADD CONSTRAINT "play_session_objects_passing_shown" CHECK ("play_session_objects"."pass_from" is null or ("play_session_objects"."shown" and "play_session_objects"."pass_from" >= 0));--> statement-breakpoint
ALTER TABLE "play_sessions" ADD CONSTRAINT "play_sessions_travel_distance" CHECK ("play_sessions"."travel_distance" >= 0);--> statement-breakpoint
ALTER TABLE "play_sessions" ADD CONSTRAINT "play_sessions_travel_only_transition" CHECK ("play_sessions"."travel_since" is null or "play_sessions"."transition");--> statement-breakpoint
ALTER TABLE "scene_objects" ADD CONSTRAINT "scene_objects_travel_mode_only_puppets" CHECK (("scene_objects"."kind" = 'puppet') = ("scene_objects"."travel_mode" is not null));