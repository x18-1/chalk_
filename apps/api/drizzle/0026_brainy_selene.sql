ALTER TABLE "agent_settings" ADD COLUMN "default_image_provider_id" text;--> statement-breakpoint
ALTER TABLE "agent_settings" ADD COLUMN "default_image_model_id" text;--> statement-breakpoint
ALTER TABLE "agent_settings" ADD COLUMN "default_video_provider_id" text;--> statement-breakpoint
ALTER TABLE "agent_settings" ADD COLUMN "default_video_model_id" text;--> statement-breakpoint
ALTER TABLE "agent_settings" ADD COLUMN "default_video_duration_seconds" integer DEFAULT 5 NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_settings" ADD COLUMN "default_video_resolution" text DEFAULT '720p' NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_settings" ADD COLUMN "speech_adapter" text DEFAULT 'browser' NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_settings" ADD COLUMN "speech_language" text DEFAULT 'zh-CN' NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_settings" ADD COLUMN "speech_voice_uri" text;--> statement-breakpoint
ALTER TABLE "agent_settings" ADD COLUMN "speech_rate" double precision DEFAULT 0.95 NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_settings" ADD COLUMN "speech_volume" double precision DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_settings" ADD CONSTRAINT "agent_settings_image_selection_check" CHECK ("agent_settings"."default_image_provider_id" IS NOT NULL OR "agent_settings"."default_image_model_id" IS NULL);--> statement-breakpoint
ALTER TABLE "agent_settings" ADD CONSTRAINT "agent_settings_video_selection_check" CHECK ("agent_settings"."default_video_provider_id" IS NOT NULL OR "agent_settings"."default_video_model_id" IS NULL);--> statement-breakpoint
ALTER TABLE "agent_settings" ADD CONSTRAINT "agent_settings_video_duration_check" CHECK ("agent_settings"."default_video_duration_seconds" BETWEEN 5 AND 20);--> statement-breakpoint
ALTER TABLE "agent_settings" ADD CONSTRAINT "agent_settings_video_resolution_check" CHECK ("agent_settings"."default_video_resolution" IN ('720p', '1080p'));--> statement-breakpoint
ALTER TABLE "agent_settings" ADD CONSTRAINT "agent_settings_speech_adapter_check" CHECK ("agent_settings"."speech_adapter" = 'browser');--> statement-breakpoint
ALTER TABLE "agent_settings" ADD CONSTRAINT "agent_settings_speech_rate_check" CHECK ("agent_settings"."speech_rate" BETWEEN 0.5 AND 2);--> statement-breakpoint
ALTER TABLE "agent_settings" ADD CONSTRAINT "agent_settings_speech_volume_check" CHECK ("agent_settings"."speech_volume" BETWEEN 0 AND 1);