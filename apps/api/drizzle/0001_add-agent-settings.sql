ALTER TABLE "mcp_servers" ADD COLUMN "env_enc" text;
ALTER TABLE "mcp_servers" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE "mcp_servers" DROP COLUMN "env";
ALTER TABLE "custom_providers" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;

CREATE TABLE "agent_settings" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"default_provider_id" text,
	"default_model_id" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "skill_settings" (
	"user_id" uuid NOT NULL,
	"skill_name" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "skill_settings_user_id_skill_name_pk" PRIMARY KEY("user_id","skill_name")
);
--> statement-breakpoint
CREATE TABLE "tool_settings" (
	"user_id" uuid NOT NULL,
	"tool_name" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"approval" text DEFAULT 'default' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tool_settings_user_id_tool_name_pk" PRIMARY KEY("user_id","tool_name")
);
--> statement-breakpoint
ALTER TABLE "agent_settings" ADD CONSTRAINT "agent_settings_user_id_auth_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "skill_settings" ADD CONSTRAINT "skill_settings_user_id_auth_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "tool_settings" ADD CONSTRAINT "tool_settings_user_id_auth_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_users"("id") ON DELETE cascade ON UPDATE no action;
