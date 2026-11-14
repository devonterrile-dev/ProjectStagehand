ALTER TABLE "assets" ADD COLUMN "processed_width" integer;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "processed_height" integer;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "processing_version" integer;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_processed_complete" CHECK (num_nonnulls("assets"."processed_path", "assets"."processed_width", "assets"."processed_height", "assets"."processing_version") in (0, 4));