CREATE TYPE "public"."roll_edge" AS ENUM('none', 'advantage', 'disadvantage');--> statement-breakpoint
ALTER TABLE "play_roll_calls" ADD COLUMN "edge" "roll_edge" DEFAULT 'none' NOT NULL;