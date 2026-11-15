-- F3.3 (D-50): live sessions, and the theater as it stands during one. All drizzle-kit's.
-- The live stage is a copy of the loaded scene (its Spot and its objects, ids kept), so it can
-- change on its own; a session's objects are deleted when it ends.
CREATE TABLE "play_session_objects" (
	"play_session_id" uuid NOT NULL,
	"id" uuid NOT NULL,
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
	CONSTRAINT "play_session_objects_play_session_id_id_pk" PRIMARY KEY("play_session_id","id"),
	CONSTRAINT "play_session_objects_inside_opening" CHECK ("play_session_objects"."across" between 0 and 1 and "play_session_objects"."up" between 0 and 1),
	CONSTRAINT "play_session_objects_depth_tick" CHECK ("play_session_objects"."depth_tick" between 0 and 9),
	CONSTRAINT "play_session_objects_scale" CHECK ("play_session_objects"."scale" between 0.25 and 2.5),
	CONSTRAINT "play_session_objects_position" CHECK ("play_session_objects"."position" >= 0),
	CONSTRAINT "play_session_objects_mount_only_props" CHECK (("play_session_objects"."kind" = 'prop') = ("play_session_objects"."mount" is not null))
);
--> statement-breakpoint
CREATE TABLE "play_sessions" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"scene_id" uuid,
	"spot_id" uuid,
	"scene_loads" integer DEFAULT 0 NOT NULL,
	"curtain_open" boolean DEFAULT false NOT NULL,
	"fear" integer NOT NULL,
	CONSTRAINT "play_sessions_number" CHECK ("play_sessions"."number" >= 1),
	CONSTRAINT "play_sessions_scene_loads" CHECK ("play_sessions"."scene_loads" >= 0),
	CONSTRAINT "play_sessions_fear" CHECK ("play_sessions"."fear" >= 0)
);
--> statement-breakpoint
ALTER TABLE "play_session_objects" ADD CONSTRAINT "play_session_objects_play_session_id_play_sessions_id_fk" FOREIGN KEY ("play_session_id") REFERENCES "public"."play_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "play_session_objects" ADD CONSTRAINT "play_session_objects_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "play_session_objects" ADD CONSTRAINT "play_session_objects_record_id_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "play_sessions" ADD CONSTRAINT "play_sessions_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "play_sessions" ADD CONSTRAINT "play_sessions_scene_id_scenes_id_fk" FOREIGN KEY ("scene_id") REFERENCES "public"."scenes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "play_sessions" ADD CONSTRAINT "play_sessions_spot_id_records_id_fk" FOREIGN KEY ("spot_id") REFERENCES "public"."records"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "play_session_objects_session_position_idx" ON "play_session_objects" USING btree ("play_session_id","position");--> statement-breakpoint
CREATE INDEX "play_session_objects_record_id_idx" ON "play_session_objects" USING btree ("record_id");--> statement-breakpoint
CREATE INDEX "play_session_objects_campaign_id_idx" ON "play_session_objects" USING btree ("campaign_id");--> statement-breakpoint
CREATE UNIQUE INDEX "play_sessions_campaign_number_unique" ON "play_sessions" USING btree ("campaign_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "play_sessions_one_active" ON "play_sessions" USING btree ("campaign_id") WHERE "play_sessions"."ended_at" is null;--> statement-breakpoint
CREATE INDEX "play_sessions_scene_id_idx" ON "play_sessions" USING btree ("scene_id");--> statement-breakpoint
CREATE INDEX "play_sessions_spot_id_idx" ON "play_sessions" USING btree ("spot_id");