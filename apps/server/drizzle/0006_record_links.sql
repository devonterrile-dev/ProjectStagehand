CREATE TYPE "public"."record_link_kind" AS ENUM('field', 'other', 'mention');--> statement-breakpoint
CREATE TABLE "record_links" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"from_record_id" uuid NOT NULL,
	"to_record_id" uuid NOT NULL,
	"kind" "record_link_kind" NOT NULL,
	"field_key" text,
	"label" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "record_links_no_self" CHECK ("record_links"."from_record_id" <> "record_links"."to_record_id"),
	CONSTRAINT "record_links_field_key_only_fields" CHECK (("record_links"."kind" = 'field') = ("record_links"."field_key" is not null)),
	CONSTRAINT "record_links_label_only_other" CHECK ("record_links"."kind" = 'other' or "record_links"."label" is null),
	CONSTRAINT "record_links_label_length" CHECK ("record_links"."label" is null or char_length("record_links"."label") between 1 and 60)
);
--> statement-breakpoint
ALTER TABLE "record_links" ADD CONSTRAINT "record_links_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_links" ADD CONSTRAINT "record_links_from_fk" FOREIGN KEY ("from_record_id","campaign_id") REFERENCES "public"."records"("id","campaign_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_links" ADD CONSTRAINT "record_links_to_fk" FOREIGN KEY ("to_record_id","campaign_id") REFERENCES "public"."records"("id","campaign_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "record_links_from_record_id_idx" ON "record_links" USING btree ("from_record_id");--> statement-breakpoint
CREATE INDEX "record_links_to_record_id_idx" ON "record_links" USING btree ("to_record_id");--> statement-breakpoint
CREATE UNIQUE INDEX "record_links_field_unique" ON "record_links" USING btree ("from_record_id","field_key","to_record_id") WHERE "record_links"."kind" = 'field';--> statement-breakpoint
CREATE UNIQUE INDEX "record_links_other_unique" ON "record_links" USING btree ("from_record_id","to_record_id") WHERE "record_links"."kind" = 'other';--> statement-breakpoint
CREATE UNIQUE INDEX "record_links_mention_unique" ON "record_links" USING btree ("from_record_id","to_record_id") WHERE "record_links"."kind" = 'mention';