CREATE TABLE "classroom_learning_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"classroom_id" uuid NOT NULL,
	"artifact_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"cursor_version" integer DEFAULT 1 NOT NULL,
	"stage_id" text NOT NULL,
	"scene_id" text,
	"scene_index" integer DEFAULT 0 NOT NULL,
	"action_index" integer DEFAULT 0 NOT NULL,
	"mode" text DEFAULT 'idle' NOT NULL,
	"completed" boolean DEFAULT false NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "classroom_learning_sessions_id_user_unique" UNIQUE("id","user_id"),
	CONSTRAINT "classroom_learning_sessions_user_artifact_unique" UNIQUE("user_id","artifact_id"),
	CONSTRAINT "classroom_learning_sessions_cursor_version_check" CHECK ("classroom_learning_sessions"."cursor_version" = 1),
	CONSTRAINT "classroom_learning_sessions_scene_index_check" CHECK ("classroom_learning_sessions"."scene_index" >= 0),
	CONSTRAINT "classroom_learning_sessions_action_index_check" CHECK ("classroom_learning_sessions"."action_index" >= 0),
	CONSTRAINT "classroom_learning_sessions_mode_check" CHECK ("classroom_learning_sessions"."mode" in ('idle', 'playing', 'paused', 'completed')),
	CONSTRAINT "classroom_learning_sessions_revision_check" CHECK ("classroom_learning_sessions"."revision" > 0)
);
--> statement-breakpoint
ALTER TABLE "classroom_learning_sessions" ADD CONSTRAINT "classroom_learning_sessions_owned_artifact_fk" FOREIGN KEY ("artifact_id","classroom_id","user_id") REFERENCES "public"."classroom_artifacts"("id","classroom_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "classroom_learning_sessions_user_updated_idx" ON "classroom_learning_sessions" USING btree ("user_id","updated_at");