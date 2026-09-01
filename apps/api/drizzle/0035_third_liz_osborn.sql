CREATE TABLE "memory_consolidation_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"error" text,
	CONSTRAINT "memory_consolidation_runs_status_check" CHECK ("memory_consolidation_runs"."status" in ('queued', 'running', 'completed', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "memory_cursors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"layer" text NOT NULL,
	"key" text NOT NULL,
	"seen_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memory_cursors_user_layer_key_unique" UNIQUE("user_id","layer","key"),
	CONSTRAINT "memory_cursors_layer_check" CHECK ("memory_cursors"."layer" in ('L2', 'L3')),
	CONSTRAINT "memory_cursors_key_check" CHECK ("memory_cursors"."key" <> '')
);
--> statement-breakpoint
CREATE TABLE "memory_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"layer" text NOT NULL,
	"surface" text,
	"slot" text,
	"section" text NOT NULL,
	"text" text NOT NULL,
	"refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memory_entries_layer_check" CHECK ("memory_entries"."layer" in ('L2', 'L3')),
	CONSTRAINT "memory_entries_scope_check" CHECK (("memory_entries"."layer" = 'L2' and "memory_entries"."surface" is not null and "memory_entries"."slot" is null) or ("memory_entries"."layer" = 'L3' and "memory_entries"."surface" is null and "memory_entries"."slot" is not null)),
	CONSTRAINT "memory_entries_text_check" CHECK (length(trim("memory_entries"."text")) > 0),
	CONSTRAINT "memory_entries_status_check" CHECK ("memory_entries"."status" in ('active', 'archived'))
);
--> statement-breakpoint
CREATE TABLE "memory_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"surface" text NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"source_type" text,
	"source_id" text,
	"fingerprint" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memory_events_user_fingerprint_unique" UNIQUE("user_id","fingerprint"),
	CONSTRAINT "memory_events_surface_check" CHECK ("memory_events"."surface" <> ''),
	CONSTRAINT "memory_events_kind_check" CHECK ("memory_events"."kind" <> '')
);
--> statement-breakpoint
ALTER TABLE "memory_consolidation_runs" ADD CONSTRAINT "memory_consolidation_runs_user_id_auth_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_cursors" ADD CONSTRAINT "memory_cursors_user_id_auth_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_entries" ADD CONSTRAINT "memory_entries_user_id_auth_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_events" ADD CONSTRAINT "memory_events_user_id_auth_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "memory_consolidation_runs_user_status_idx" ON "memory_consolidation_runs" USING btree ("user_id","status","requested_at");--> statement-breakpoint
CREATE INDEX "memory_entries_user_layer_scope_idx" ON "memory_entries" USING btree ("user_id","layer","surface","slot","updated_at");--> statement-breakpoint
CREATE INDEX "memory_events_user_surface_occurred_idx" ON "memory_events" USING btree ("user_id","surface","occurred_at");