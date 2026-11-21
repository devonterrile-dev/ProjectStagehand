ALTER TABLE "characters" DROP CONSTRAINT "characters_numbers_nonnegative";--> statement-breakpoint
ALTER TABLE "campaigns" ALTER COLUMN "ruleset_version" SET DEFAULT 2;--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "hope_bonus" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "characters" ADD CONSTRAINT "characters_numbers_nonnegative" CHECK (least("characters"."evasion", "characters"."armor_score", "characters"."armor_slots_max", "characters"."armor_slots_marked", "characters"."minor_threshold", "characters"."major_threshold", "characters"."severe_threshold", "characters"."hp_max", "characters"."hp_current", "characters"."stress_max", "characters"."stress_current", "characters"."hope", "characters"."hope_bonus", "characters"."proficiency") >= 0);--> statement-breakpoint
-- Ruleset v2 (F4.1, D-58): every campaign moves to it, archived ones too. v1 stays published.
UPDATE "campaigns" SET "ruleset_version" = 2 WHERE "ruleset_version" = 1;--> statement-breakpoint
-- v2 caps the level at 10, so no stored sheet is left above it.
UPDATE "characters" SET "level" = 10 WHERE "level" > 10;
