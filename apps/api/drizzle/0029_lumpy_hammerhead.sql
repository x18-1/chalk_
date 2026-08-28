CREATE TABLE "classroom_discussion_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"discussion_id" uuid NOT NULL,
	"round_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"sender" text NOT NULL,
	"agent_id" text,
	"agent_name" text,
	"agent_role" text,
	"content" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'streaming' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "classroom_discussion_messages_id_user_unique" UNIQUE("id","user_id"),
	CONSTRAINT "classroom_discussion_messages_session_sequence_unique" UNIQUE("discussion_id","sequence"),
	CONSTRAINT "classroom_discussion_messages_sender_check" CHECK ("classroom_discussion_messages"."sender" in ('student', 'agent', 'system')),
	CONSTRAINT "classroom_discussion_messages_status_check" CHECK ("classroom_discussion_messages"."status" in ('streaming', 'completed', 'interrupted'))
);
--> statement-breakpoint
CREATE TABLE "classroom_discussion_rounds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"discussion_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"director_prompt_id" text,
	"director_prompt_revision" text,
	"participant_prompt_id" text,
	"participant_prompt_revision" text,
	"model_provider_id" text,
	"model_id" text,
	"error_code" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "classroom_discussion_rounds_owned_id_unique" UNIQUE("id","discussion_id","user_id"),
	CONSTRAINT "classroom_discussion_rounds_status_check" CHECK ("classroom_discussion_rounds"."status" in ('running', 'completed', 'aborted', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "classroom_discussion_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"learning_session_id" uuid,
	"generation_run_id" uuid,
	"scene_id" text NOT NULL,
	"topic" text NOT NULL,
	"prompt" text,
	"trigger_agent_id" text,
	"participants" jsonb NOT NULL,
	"entry_cursor" jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "classroom_discussion_sessions_id_user_unique" UNIQUE("id","user_id"),
	CONSTRAINT "classroom_discussion_sessions_target_check" CHECK (("classroom_discussion_sessions"."learning_session_id" is not null and "classroom_discussion_sessions"."generation_run_id" is null) or ("classroom_discussion_sessions"."learning_session_id" is null and "classroom_discussion_sessions"."generation_run_id" is not null)),
	CONSTRAINT "classroom_discussion_sessions_status_check" CHECK ("classroom_discussion_sessions"."status" in ('active', 'completed', 'aborted', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "classroom_discussion_messages" ADD CONSTRAINT "classroom_discussion_messages_owned_round_fk" FOREIGN KEY ("round_id","discussion_id","user_id") REFERENCES "public"."classroom_discussion_rounds"("id","discussion_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "classroom_discussion_rounds" ADD CONSTRAINT "classroom_discussion_rounds_owned_session_fk" FOREIGN KEY ("discussion_id","user_id") REFERENCES "public"."classroom_discussion_sessions"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "classroom_discussion_sessions" ADD CONSTRAINT "classroom_discussion_sessions_owned_learning_session_fk" FOREIGN KEY ("learning_session_id","user_id") REFERENCES "public"."classroom_learning_sessions"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "classroom_discussion_sessions" ADD CONSTRAINT "classroom_discussion_sessions_owned_generation_run_fk" FOREIGN KEY ("generation_run_id","user_id") REFERENCES "public"."classroom_generation_runs"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "classroom_discussion_messages_user_session_idx" ON "classroom_discussion_messages" USING btree ("user_id","discussion_id","sequence");--> statement-breakpoint
CREATE INDEX "classroom_discussion_rounds_user_session_idx" ON "classroom_discussion_rounds" USING btree ("user_id","discussion_id","started_at");--> statement-breakpoint
CREATE INDEX "classroom_discussion_sessions_learning_scene_idx" ON "classroom_discussion_sessions" USING btree ("user_id","learning_session_id","scene_id","updated_at");--> statement-breakpoint
CREATE INDEX "classroom_discussion_sessions_generation_scene_idx" ON "classroom_discussion_sessions" USING btree ("user_id","generation_run_id","scene_id","updated_at");