-- F3.2 (D-49): scenes and the props and NPC puppets placed in them. All drizzle-kit's.
-- A scene keeps its Spot, not a backdrop image, and an object keeps its record: both are drawn
-- with the image in use when the scene is read.
CREATE TYPE "public"."prop_mount" AS ENUM('stand', 'hang');--> statement-breakpoint
CREATE TYPE "public"."scene_object_kind" AS ENUM('prop', 'puppet');--> statement-breakpoint
CREATE TYPE "public"."scene_type" AS ENUM('static', 'transition', 'battle');--> statement-breakpoint
CREATE TABLE "scene_objects" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"scene_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"kind" "scene_object_kind" NOT NULL,
	"record_id" uuid NOT NULL,
	"across" double precision NOT NULL,
	"up" double precision NOT NULL,
	"depth_tick" integer NOT NULL,
	"scale" double precision DEFAULT 1 NOT NULL,
	"flipped" boolean DEFAULT false NOT NULL,
	"shown" boolean NOT NULL,
	"mount" "prop_mount",
	"position" integer NOT NULL,
	CONSTRAINT "scene_objects_inside_opening" CHECK ("scene_objects"."across" between 0 and 1 and "scene_objects"."up" between 0 and 1),
	CONSTRAINT "scene_objects_depth_tick" CHECK ("scene_objects"."depth_tick" between 0 and 9),
	CONSTRAINT "scene_objects_scale" CHECK ("scene_objects"."scale" between 0.25 and 2.5),
	CONSTRAINT "scene_objects_position" CHECK ("scene_objects"."position" >= 0),
	CONSTRAINT "scene_objects_puppets_lowered" CHECK ("scene_objects"."kind" = 'prop' or not "scene_objects"."shown"),
	CONSTRAINT "scene_objects_mount_only_props" CHECK (("scene_objects"."kind" = 'prop') = ("scene_objects"."mount" is not null))
);
--> statement-breakpoint
CREATE TABLE "scenes" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"name" text NOT NULL,
	"type" "scene_type" DEFAULT 'static' NOT NULL,
	"spot_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scenes_name_length" CHECK (char_length("scenes"."name") between 1 and 120)
);
--> statement-breakpoint
ALTER TABLE "scene_objects" ADD CONSTRAINT "scene_objects_scene_id_scenes_id_fk" FOREIGN KEY ("scene_id") REFERENCES "public"."scenes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scene_objects" ADD CONSTRAINT "scene_objects_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scene_objects" ADD CONSTRAINT "scene_objects_record_id_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenes" ADD CONSTRAINT "scenes_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenes" ADD CONSTRAINT "scenes_spot_id_records_id_fk" FOREIGN KEY ("spot_id") REFERENCES "public"."records"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "scene_objects_scene_id_position_idx" ON "scene_objects" USING btree ("scene_id","position");--> statement-breakpoint
CREATE INDEX "scene_objects_record_id_idx" ON "scene_objects" USING btree ("record_id");--> statement-breakpoint
CREATE INDEX "scene_objects_campaign_id_idx" ON "scene_objects" USING btree ("campaign_id");--> statement-breakpoint
CREATE UNIQUE INDEX "scene_objects_puppet_unique" ON "scene_objects" USING btree ("scene_id","record_id") WHERE "scene_objects"."kind" = 'puppet';--> statement-breakpoint
CREATE INDEX "scenes_campaign_id_idx" ON "scenes" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "scenes_spot_id_idx" ON "scenes" USING btree ("spot_id");