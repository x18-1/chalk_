ALTER TABLE "classroom_draft_scenes" ADD COLUMN "actions" jsonb;--> statement-breakpoint
ALTER TABLE "classroom_draft_scenes" ADD COLUMN "action_status" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "classroom_draft_scenes" ADD COLUMN "action_attempt" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "classroom_draft_scenes" ADD COLUMN "action_prompt_id" text;--> statement-breakpoint
ALTER TABLE "classroom_draft_scenes" ADD COLUMN "action_prompt_revision" text;--> statement-breakpoint
ALTER TABLE "classroom_draft_scenes" ADD COLUMN "action_model_provider_id" text;--> statement-breakpoint
ALTER TABLE "classroom_draft_scenes" ADD COLUMN "action_model_id" text;--> statement-breakpoint
ALTER TABLE "classroom_draft_scenes" ADD COLUMN "action_error_code" text;--> statement-breakpoint
ALTER TABLE "classroom_draft_scenes" ADD COLUMN "action_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "classroom_draft_scenes" ADD COLUMN "action_finished_at" timestamp with time zone;