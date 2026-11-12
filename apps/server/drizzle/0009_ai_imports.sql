CREATE TYPE "public"."ai_import_mode" AS ENUM('bootstrap', 'add', 'fill');--> statement-breakpoint
CREATE TYPE "public"."ai_import_status" AS ENUM('running', 'ready', 'failed', 'committed', 'discarded');--> statement-breakpoint
CREATE TYPE "public"."ai_proposal_action" AS ENUM('create', 'update', 'link');--> statement-breakpoint
CREATE TYPE "public"."ai_proposal_review_state" AS ENUM('pending', 'accepted', 'edited', 'rejected');--> statement-breakpoint
CREATE TABLE "ai_imports" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"mode" "ai_import_mode" NOT NULL,
	"target_types" jsonb,
	"fill_record_id" uuid,
	"input_text" text NOT NULL,
	"prompt_version" integer NOT NULL,
	"model" text NOT NULL,
	"status" "ai_import_status" DEFAULT 'running' NOT NULL,
	"error_code" text,
	"error_details" jsonb,
	"questions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cache_read_tokens" integer DEFAULT 0 NOT NULL,
	"cache_write_tokens" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"committed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_imports_id_campaign_id_unique" UNIQUE("id","campaign_id"),
	CONSTRAINT "ai_imports_error_only_failed" CHECK (("ai_imports"."status" = 'failed') = ("ai_imports"."error_code" is not null)),
	CONSTRAINT "ai_imports_attempts_check" CHECK ("ai_imports"."attempts" between 0 and 2)
);
--> statement-breakpoint
CREATE TABLE "ai_proposals" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"import_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"action" "ai_proposal_action" NOT NULL,
	"payload" jsonb NOT NULL,
	"original_payload" jsonb NOT NULL,
	"review_state" "ai_proposal_review_state" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_proposals_import_id_position_unique" UNIQUE("import_id","position")
);
--> statement-breakpoint
ALTER TABLE "records" ADD COLUMN "ai_import_id" uuid;--> statement-breakpoint
ALTER TABLE "ai_imports" ADD CONSTRAINT "ai_imports_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_imports" ADD CONSTRAINT "ai_imports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_proposals" ADD CONSTRAINT "ai_proposals_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_proposals" ADD CONSTRAINT "ai_proposals_import_fk" FOREIGN KEY ("import_id","campaign_id") REFERENCES "public"."ai_imports"("id","campaign_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_imports_campaign_id_created_at_idx" ON "ai_imports" USING btree ("campaign_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_imports_user_id_created_at_idx" ON "ai_imports" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_imports_one_running_per_user" ON "ai_imports" USING btree ("user_id") WHERE "ai_imports"."status" = 'running';--> statement-breakpoint
ALTER TABLE "records" ADD CONSTRAINT "records_ai_import_id_ai_imports_id_fk" FOREIGN KEY ("ai_import_id") REFERENCES "public"."ai_imports"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "records_ai_import_id_idx" ON "records" USING btree ("ai_import_id");