CREATE TYPE "public"."asset_source" AS ENUM('generated', 'uploaded');--> statement-breakpoint
ALTER TABLE "assets" ALTER COLUMN "prompt" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "assets" ALTER COLUMN "model" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "assets" ALTER COLUMN "style_bible_version" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "assets" ALTER COLUMN "quality" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "assets" ALTER COLUMN "aspect_ratio" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "source" "asset_source" DEFAULT 'generated' NOT NULL;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "finished" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_generated_made" CHECK ("assets"."source" = 'uploaded' or num_nonnulls("assets"."prompt", "assets"."model", "assets"."style_bible_version", "assets"."quality", "assets"."aspect_ratio") = 5);--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_finished_only_uploaded" CHECK (not "assets"."finished" or "assets"."source" = 'uploaded');