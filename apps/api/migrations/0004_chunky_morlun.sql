CREATE TABLE `analyses` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`opportunity_id` integer NOT NULL,
	`status` text NOT NULL,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`prompt_version` text NOT NULL,
	`schema_version` integer NOT NULL,
	`result_json` text,
	`breakdown_json` text,
	`guard_notes_json` text,
	`error` text,
	`input_tokens` integer,
	`output_tokens` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`opportunity_id`) REFERENCES `opportunities`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `analyses_opportunity_idx` ON `analyses` (`opportunity_id`,`id`);--> statement-breakpoint
CREATE INDEX `analyses_created_at_idx` ON `analyses` (`created_at`);--> statement-breakpoint
ALTER TABLE `opportunities` ADD `prefilter_rule` text;--> statement-breakpoint
ALTER TABLE `opportunities` ADD `prefilter_matches` integer;--> statement-breakpoint
ALTER TABLE `opportunities` ADD `prefilter_at` integer;--> statement-breakpoint
ALTER TABLE `opportunities` ADD `language` text;--> statement-breakpoint
ALTER TABLE `opportunities` ADD `analysis_provider` text;--> statement-breakpoint
ALTER TABLE `opportunities` ADD `industry` text;--> statement-breakpoint
ALTER TABLE `opportunities` ADD `work_mode` text;--> statement-breakpoint
ALTER TABLE `opportunities` ADD `countries` text;--> statement-breakpoint
ALTER TABLE `opportunities` ADD `amount_max_minor` integer;--> statement-breakpoint
ALTER TABLE `opportunities` ADD `amount_currency` text;