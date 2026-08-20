CREATE TABLE "agent_run_observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"session_id" text NOT NULL,
	"model_provider_id" text,
	"model_id" text,
	"status" text NOT NULL,
	"duration_ms" integer NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"total_cost" double precision,
	"error_category" text,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_run_observations" ADD CONSTRAINT "agent_run_observations_user_id_auth_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_run_observations" ADD CONSTRAINT "agent_run_observations_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_run_observations_conversation_started_idx" ON "agent_run_observations" USING btree ("conversation_id","started_at");--> statement-breakpoint
CREATE INDEX "agent_run_observations_user_started_idx" ON "agent_run_observations" USING btree ("user_id","started_at");