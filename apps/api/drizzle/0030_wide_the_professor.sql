ALTER TABLE "classroom_drafts" DROP CONSTRAINT "classroom_drafts_publication_check";--> statement-breakpoint
INSERT INTO "classrooms" ("id", "user_id", "title", "description", "created_at", "updated_at")
SELECT
	"id",
	"user_id",
	COALESCE(NULLIF("outline" ->> 'courseTitle', ''), NULLIF(LEFT(BTRIM("requirements"), 120), ''), '正在准备的新课堂'),
	"requirements",
	"created_at",
	"updated_at"
FROM "classroom_drafts"
WHERE "classroom_id" IS NULL AND "artifact_id" IS NULL AND "published_at" IS NULL
ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint
UPDATE "classroom_drafts"
SET "classroom_id" = "id"
WHERE "classroom_id" IS NULL AND "artifact_id" IS NULL AND "published_at" IS NULL;--> statement-breakpoint
ALTER TABLE "classroom_drafts" ADD CONSTRAINT "classroom_drafts_publication_check" CHECK (("classroom_drafts"."classroom_id" is null and "classroom_drafts"."artifact_id" is null and "classroom_drafts"."published_at" is null) or ("classroom_drafts"."classroom_id" is not null and "classroom_drafts"."artifact_id" is null and "classroom_drafts"."published_at" is null) or ("classroom_drafts"."classroom_id" is not null and "classroom_drafts"."artifact_id" is not null and "classroom_drafts"."published_at" is not null));
