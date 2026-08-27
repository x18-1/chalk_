ALTER TABLE "classroom_learning_sessions" ADD CONSTRAINT "classroom_learning_sessions_owned_artifact_unique" UNIQUE("id","artifact_id","classroom_id","user_id");--> statement-breakpoint
CREATE TABLE "classroom_quiz_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"learning_session_id" uuid NOT NULL,
	"classroom_id" uuid NOT NULL,
	"artifact_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"scene_id" text NOT NULL,
	"answers" jsonb NOT NULL,
	"results" jsonb NOT NULL,
	"score" integer NOT NULL,
	"max_score" integer NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "classroom_quiz_attempts_id_user_unique" UNIQUE("id","user_id"),
	CONSTRAINT "classroom_quiz_attempts_session_scene_unique" UNIQUE("learning_session_id","scene_id"),
	CONSTRAINT "classroom_quiz_attempts_score_check" CHECK ("classroom_quiz_attempts"."score" >= 0),
	CONSTRAINT "classroom_quiz_attempts_max_score_check" CHECK ("classroom_quiz_attempts"."max_score" >= 0),
	CONSTRAINT "classroom_quiz_attempts_revision_check" CHECK ("classroom_quiz_attempts"."revision" > 0)
);
--> statement-breakpoint
ALTER TABLE "classroom_quiz_attempts" ADD CONSTRAINT "classroom_quiz_attempts_owned_session_artifact_fk" FOREIGN KEY ("learning_session_id","artifact_id","classroom_id","user_id") REFERENCES "public"."classroom_learning_sessions"("id","artifact_id","classroom_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "classroom_quiz_attempts_user_session_idx" ON "classroom_quiz_attempts" USING btree ("user_id","learning_session_id");
