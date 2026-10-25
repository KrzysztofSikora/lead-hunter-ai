CREATE TABLE `job_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`job_type` text NOT NULL,
	`source_id` integer,
	`status` text NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`fetched` integer DEFAULT 0 NOT NULL,
	`new` integer DEFAULT 0 NOT NULL,
	`duplicates` integer DEFAULT 0 NOT NULL,
	`failed` integer DEFAULT 0 NOT NULL,
	`error_reason` text,
	`error_status` integer,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `job_runs_source_idx` ON `job_runs` (`source_id`,`started_at`);--> statement-breakpoint
CREATE TABLE `sources` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`type` text NOT NULL,
	`name` text NOT NULL,
	`config_json` text NOT NULL,
	`config_key` text NOT NULL,
	`preset_id` text,
	`enabled` integer DEFAULT true NOT NULL,
	`cursor_json` text,
	`next_allowed_at` integer,
	`last_attempt_at` integer,
	`last_success_at` integer,
	`last_error_reason` text,
	`last_error_status` integer,
	`last_error_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sources_config_key_unique` ON `sources` (`config_key`);--> statement-breakpoint
CREATE INDEX `sources_enabled_idx` ON `sources` (`enabled`);--> statement-breakpoint
ALTER TABLE `raw_signals` ADD `source_id` integer REFERENCES sources(id);--> statement-breakpoint
ALTER TABLE `raw_signals` ADD `external_id` text;