CREATE TABLE "classroom_artifact_media" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"artifact_id" uuid NOT NULL,
	"classroom_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"path" text NOT NULL,
	"object_key" text NOT NULL,
	"content_type" text NOT NULL,
	"size" integer NOT NULL,
	"content_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "classroom_artifact_media_object_key_unique" UNIQUE("object_key"),
	CONSTRAINT "classroom_artifact_media_artifact_path_unique" UNIQUE("artifact_id","path")
);
--> statement-breakpoint
ALTER TABLE "classroom_artifacts" ADD CONSTRAINT "classroom_artifacts_owned_id_unique" UNIQUE("id","classroom_id","user_id");--> statement-breakpoint
ALTER TABLE "classroom_artifact_media" ADD CONSTRAINT "classroom_artifact_media_owned_artifact_fk" FOREIGN KEY ("artifact_id","classroom_id","user_id") REFERENCES "public"."classroom_artifacts"("id","classroom_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "classroom_artifact_media_user_artifact_idx" ON "classroom_artifact_media" USING btree ("user_id","artifact_id");
