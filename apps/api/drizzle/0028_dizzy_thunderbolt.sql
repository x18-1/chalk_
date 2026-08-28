CREATE TABLE "classroom_outline_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"event_order" integer NOT NULL,
	"type" text NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "classroom_outline_events_run_order_unique" UNIQUE("run_id","event_order")
);
--> statement-breakpoint
ALTER TABLE "classroom_outline_events" ADD CONSTRAINT "classroom_outline_events_owned_run_fk" FOREIGN KEY ("run_id","user_id") REFERENCES "public"."classroom_generation_runs"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "classroom_outline_events_user_run_id_idx" ON "classroom_outline_events" USING btree ("user_id","run_id","id");