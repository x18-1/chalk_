CREATE TABLE "classroom_draft_media_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"draft_id" uuid NOT NULL,
	"scene_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"action_id" text NOT NULL,
	"task_key" text NOT NULL,
	"kind" text NOT NULL,
	"input" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempt" integer DEFAULT 0 NOT NULL,
	"provider_id" text,
	"model_id" text,
	"media_ref" text,
	"object_key" text,
	"content_type" text,
	"size" integer,
	"content_hash" text,
	"error_code" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "classroom_draft_media_tasks_object_key_unique" UNIQUE("object_key"),
	CONSTRAINT "classroom_draft_media_tasks_draft_key_unique" UNIQUE("draft_id","task_key")
);
--> statement-breakpoint
ALTER TABLE "classroom_draft_media_tasks" ADD CONSTRAINT "classroom_draft_media_tasks_owned_run_fk" FOREIGN KEY ("run_id","user_id") REFERENCES "public"."classroom_generation_runs"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "classroom_draft_media_tasks" ADD CONSTRAINT "classroom_draft_media_tasks_owned_scene_fk" FOREIGN KEY ("scene_id","user_id") REFERENCES "public"."classroom_draft_scenes"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "classroom_draft_media_tasks_user_run_idx" ON "classroom_draft_media_tasks" USING btree ("user_id","run_id","created_at");