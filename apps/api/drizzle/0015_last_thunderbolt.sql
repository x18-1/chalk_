ALTER TABLE "classroom_generation_runs" ALTER COLUMN "status" SET DEFAULT 'queued';--> statement-breakpoint
ALTER TABLE "classroom_generation_runs" ALTER COLUMN "started_at" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "classroom_generation_runs" ALTER COLUMN "started_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "classroom_generation_runs" ADD COLUMN "lease_owner" text;--> statement-breakpoint
ALTER TABLE "classroom_generation_runs" ADD COLUMN "lease_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "classroom_generation_runs" ADD COLUMN "heartbeat_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "classroom_generation_runs" ADD COLUMN "cancel_requested_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "classroom_generation_runs_claim_idx" ON "classroom_generation_runs" USING btree ("status","lease_expires_at","created_at");