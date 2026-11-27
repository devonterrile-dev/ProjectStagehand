CREATE TABLE "scene_next" (
	"scene_id" uuid NOT NULL,
	"next_scene_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "scene_next_scene_id_next_scene_id_pk" PRIMARY KEY("scene_id","next_scene_id"),
	CONSTRAINT "scene_next_not_itself" CHECK ("scene_next"."scene_id" <> "scene_next"."next_scene_id"),
	CONSTRAINT "scene_next_position" CHECK ("scene_next"."position" >= 0)
);
--> statement-breakpoint
ALTER TABLE "scene_next" ADD CONSTRAINT "scene_next_scene_id_scenes_id_fk" FOREIGN KEY ("scene_id") REFERENCES "public"."scenes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scene_next" ADD CONSTRAINT "scene_next_next_scene_id_scenes_id_fk" FOREIGN KEY ("next_scene_id") REFERENCES "public"."scenes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scene_next" ADD CONSTRAINT "scene_next_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "scene_next_next_scene_id_idx" ON "scene_next" USING btree ("next_scene_id");--> statement-breakpoint
CREATE INDEX "scene_next_campaign_id_idx" ON "scene_next" USING btree ("campaign_id");