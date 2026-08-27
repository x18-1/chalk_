CREATE TABLE "classroom_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"requirements" text NOT NULL,
	"context" jsonb NOT NULL,
	"outline" jsonb,
	"status" text DEFAULT 'generating' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "classroom_drafts_id_user_unique" UNIQUE("id","user_id")
);
--> statement-breakpoint
CREATE TABLE "classroom_generation_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"draft_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"stage" text DEFAULT 'outline' NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"attempt" integer DEFAULT 1 NOT NULL,
	"prompt_id" text NOT NULL,
	"prompt_revision" text NOT NULL,
	"model_provider_id" text,
	"model_id" text,
	"error_code" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "classroom_generation_runs_id_user_unique" UNIQUE("id","user_id")
);
--> statement-breakpoint
ALTER TABLE "classroom_drafts" ADD CONSTRAINT "classroom_drafts_user_id_auth_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "classroom_generation_runs" ADD CONSTRAINT "classroom_generation_runs_owned_draft_fk" FOREIGN KEY ("draft_id","user_id") REFERENCES "public"."classroom_drafts"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "classroom_drafts_user_updated_idx" ON "classroom_drafts" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE INDEX "classroom_generation_runs_user_updated_idx" ON "classroom_generation_runs" USING btree ("user_id","updated_at");