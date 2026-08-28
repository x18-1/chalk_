ALTER TABLE "classroom_discussion_rounds" ADD COLUMN "lease_owner" text;--> statement-breakpoint
ALTER TABLE "classroom_discussion_rounds" ADD COLUMN "heartbeat_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "classroom_discussion_rounds" ADD COLUMN "abort_requested_at" timestamp with time zone;