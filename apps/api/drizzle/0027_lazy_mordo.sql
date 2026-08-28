CREATE TABLE "classroom_outline_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"draft_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"outline" jsonb NOT NULL,
	"content_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "classroom_outline_revisions_owned_id_unique" UNIQUE("id","draft_id","user_id"),
	CONSTRAINT "classroom_outline_revisions_draft_number_unique" UNIQUE("draft_id","number"),
	CONSTRAINT "classroom_outline_revisions_draft_idempotency_unique" UNIQUE("draft_id","idempotency_key")
);
--> statement-breakpoint
ALTER TABLE "classroom_draft_scenes" ADD COLUMN "outline_revision_id" uuid;--> statement-breakpoint
ALTER TABLE "classroom_generation_runs" ADD COLUMN "outline_revision_id" uuid;--> statement-breakpoint
ALTER TABLE "classroom_outline_revisions" ADD CONSTRAINT "classroom_outline_revisions_owned_draft_fk" FOREIGN KEY ("draft_id","user_id") REFERENCES "public"."classroom_drafts"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "classroom_outline_revisions_user_draft_idx" ON "classroom_outline_revisions" USING btree ("user_id","draft_id","number");--> statement-breakpoint
ALTER TABLE "classroom_draft_scenes" ADD CONSTRAINT "classroom_draft_scenes_owned_outline_revision_fk" FOREIGN KEY ("outline_revision_id","draft_id","user_id") REFERENCES "public"."classroom_outline_revisions"("id","draft_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "classroom_generation_runs" ADD CONSTRAINT "classroom_generation_runs_owned_outline_revision_fk" FOREIGN KEY ("outline_revision_id","draft_id","user_id") REFERENCES "public"."classroom_outline_revisions"("id","draft_id","user_id") ON DELETE cascade ON UPDATE no action;