CREATE TYPE "public"."auth_user_role" AS ENUM('admin', 'user');--> statement-breakpoint
ALTER TABLE "auth_users" ADD COLUMN "role" "auth_user_role" DEFAULT 'user' NOT NULL;