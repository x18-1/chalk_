ALTER TABLE "classroom_draft_media_tasks" ALTER COLUMN "action_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "classroom_draft_media_tasks" ADD COLUMN "element_id" text;--> statement-breakpoint
ALTER TABLE "classroom_draft_media_tasks" ADD COLUMN "provider_task_id" text;