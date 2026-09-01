CREATE TABLE IF NOT EXISTS "knowledge_bases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "knowledge_bases_id_user_unique" UNIQUE("id","user_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "knowledge_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"knowledge_base_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"filename" text NOT NULL,
	"content_type" text NOT NULL,
	"size" integer NOT NULL,
	"file_key" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"error" text,
	"chunk_count" integer,
	"page_count" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"indexed_at" timestamp with time zone,
	CONSTRAINT "knowledge_documents_file_key_unique" UNIQUE("file_key")
);
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'knowledge_bases_user_id_auth_users_id_fk') THEN
    ALTER TABLE "knowledge_bases" ADD CONSTRAINT "knowledge_bases_user_id_auth_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_users"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'knowledge_documents_user_id_auth_users_id_fk') THEN
    ALTER TABLE "knowledge_documents" ADD CONSTRAINT "knowledge_documents_user_id_auth_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_users"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'knowledge_documents_owned_kb_fk') THEN
    ALTER TABLE "knowledge_documents" ADD CONSTRAINT "knowledge_documents_owned_kb_fk" FOREIGN KEY ("knowledge_base_id","user_id") REFERENCES "public"."knowledge_bases"("id","user_id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "knowledge_bases_user_updated_idx" ON "knowledge_bases" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "knowledge_documents_user_kb_updated_idx" ON "knowledge_documents" USING btree ("user_id","knowledge_base_id","updated_at");
