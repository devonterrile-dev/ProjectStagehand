ALTER TYPE "public"."ai_import_status" ADD VALUE 'questions' BEFORE 'ready';--> statement-breakpoint
ALTER TABLE "ai_imports" ADD COLUMN "phase" text DEFAULT 'records' NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_imports" ADD COLUMN "conversation" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_imports" ADD COLUMN "steps" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_imports" ADD CONSTRAINT "ai_imports_phase_check" CHECK ("ai_imports"."phase" in ('questions', 'records'));