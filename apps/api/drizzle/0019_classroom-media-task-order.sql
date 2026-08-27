DROP INDEX "classroom_draft_media_tasks_user_run_idx";--> statement-breakpoint
ALTER TABLE "classroom_draft_media_tasks" ADD COLUMN "task_order" integer NOT NULL;--> statement-breakpoint
CREATE INDEX "classroom_draft_media_tasks_user_run_idx" ON "classroom_draft_media_tasks" USING btree ("user_id","run_id","task_order");