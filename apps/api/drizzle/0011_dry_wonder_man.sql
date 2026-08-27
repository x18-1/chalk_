CREATE TABLE "classroom_artifacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"classroom_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"content_object_key" text NOT NULL,
	"content_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "classroom_artifacts_content_object_key_unique" UNIQUE("content_object_key"),
	CONSTRAINT "classroom_artifacts_classroom_version_unique" UNIQUE("classroom_id","version"),
	CONSTRAINT "classroom_artifacts_classroom_hash_unique" UNIQUE("classroom_id","content_hash")
);
--> statement-breakpoint
CREATE TABLE "classrooms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"source_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "classrooms_id_user_unique" UNIQUE("id","user_id"),
	CONSTRAINT "classrooms_user_source_unique" UNIQUE("user_id","source_key")
);
--> statement-breakpoint
ALTER TABLE "classroom_artifacts" ADD CONSTRAINT "classroom_artifacts_owned_classroom_fk" FOREIGN KEY ("classroom_id","user_id") REFERENCES "public"."classrooms"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "classrooms" ADD CONSTRAINT "classrooms_user_id_auth_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "classroom_artifacts_user_classroom_idx" ON "classroom_artifacts" USING btree ("user_id","classroom_id");--> statement-breakpoint
CREATE INDEX "classrooms_user_updated_idx" ON "classrooms" USING btree ("user_id","updated_at");