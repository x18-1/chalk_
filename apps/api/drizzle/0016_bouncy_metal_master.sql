CREATE TABLE "classroom_draft_scenes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"draft_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"outline_id" text NOT NULL,
	"type" text NOT NULL,
	"order" integer NOT NULL,
	"outline" jsonb NOT NULL,
	"content" jsonb,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempt" integer DEFAULT 0 NOT NULL,
	"prompt_id" text,
	"prompt_revision" text,
	"model_provider_id" text,
	"model_id" text,
	"error_code" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "classroom_draft_scenes_id_user_unique" UNIQUE("id","user_id"),
	CONSTRAINT "classroom_draft_scenes_draft_outline_unique" UNIQUE("draft_id","outline_id"),
	CONSTRAINT "classroom_draft_scenes_draft_order_unique" UNIQUE("draft_id","order")
);
--> statement-breakpoint
ALTER TABLE "classroom_generation_runs" ALTER COLUMN "prompt_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "classroom_generation_runs" ALTER COLUMN "prompt_revision" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "classroom_draft_scenes" ADD CONSTRAINT "classroom_draft_scenes_owned_draft_fk" FOREIGN KEY ("draft_id","user_id") REFERENCES "public"."classroom_drafts"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "classroom_draft_scenes_user_draft_idx" ON "classroom_draft_scenes" USING btree ("user_id","draft_id","order");--> statement-breakpoint
ALTER TABLE "classroom_generation_runs" ADD CONSTRAINT "classroom_generation_runs_draft_stage_unique" UNIQUE("draft_id","stage");