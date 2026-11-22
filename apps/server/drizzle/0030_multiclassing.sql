ALTER TABLE "characters" ADD COLUMN "multiclass_class_id" uuid;--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "multiclass_domain_id" uuid;--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "multiclass_subclass_id" uuid;--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "multiclass_subclass_cards" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "characters" ADD CONSTRAINT "characters_multiclass_class_fk" FOREIGN KEY ("multiclass_class_id","campaign_id") REFERENCES "public"."classes"("id","campaign_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "characters" ADD CONSTRAINT "characters_multiclass_domain_fk" FOREIGN KEY ("multiclass_domain_id","campaign_id") REFERENCES "public"."domains"("id","campaign_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "characters" ADD CONSTRAINT "characters_multiclass_subclass_fk" FOREIGN KEY ("multiclass_subclass_id","campaign_id") REFERENCES "public"."subclasses"("id","campaign_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "characters" ADD CONSTRAINT "characters_multiclass_subclass_cards" CHECK ("characters"."multiclass_subclass_cards" between 0 and 3);--> statement-breakpoint
ALTER TABLE "characters" ADD CONSTRAINT "characters_multiclass_needs_class" CHECK (("characters"."multiclass_domain_id" is null and "characters"."multiclass_subclass_id" is null) or "characters"."multiclass_class_id" is not null);