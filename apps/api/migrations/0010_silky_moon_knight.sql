CREATE TABLE `offer_drafts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`opportunity_id` integer NOT NULL,
	`status` text NOT NULL,
	`language` text NOT NULL,
	`subject` text NOT NULL,
	`message_markdown` text NOT NULL,
	`proposal_markdown` text NOT NULL,
	`content_json` text,
	`guard_notes_json` text,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`prompt_version` text NOT NULL,
	`schema_version` integer NOT NULL,
	`analysed` integer DEFAULT 0 NOT NULL,
	`error` text,
	`input_tokens` integer,
	`output_tokens` integer,
	`cost_micro_usd` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`status_changed_at` integer NOT NULL,
	FOREIGN KEY (`opportunity_id`) REFERENCES `opportunities`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `offer_drafts_opportunity_idx` ON `offer_drafts` (`opportunity_id`,`id`);--> statement-breakpoint
CREATE INDEX `offer_drafts_created_at_idx` ON `offer_drafts` (`created_at`);