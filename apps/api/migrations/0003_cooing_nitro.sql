CREATE TABLE `opportunities` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`primary_signal_id` integer NOT NULL,
	`business_status` text DEFAULT 'NEW' NOT NULL,
	`analysis_status` text DEFAULT 'PENDING' NOT NULL,
	`category` text,
	`evidence_level` text,
	`score` integer,
	`confidence` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`last_verified_at` integer,
	FOREIGN KEY (`primary_signal_id`) REFERENCES `raw_signals`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "score_range" CHECK("opportunities"."score" IS NULL OR "opportunities"."score" BETWEEN 0 AND 100)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `opportunities_primary_signal_id_unique` ON `opportunities` (`primary_signal_id`);--> statement-breakpoint
CREATE INDEX `opportunities_business_status_idx` ON `opportunities` (`business_status`);--> statement-breakpoint
CREATE INDEX `opportunities_score_idx` ON `opportunities` (`score`);--> statement-breakpoint
CREATE INDEX `opportunities_created_at_idx` ON `opportunities` (`created_at`);--> statement-breakpoint
CREATE TABLE `opportunity_evidence` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`opportunity_id` integer NOT NULL,
	`raw_signal_id` integer NOT NULL,
	`evidence_type` text NOT NULL,
	`source_fact` text NOT NULL,
	`source_url` text,
	`canonical_url` text,
	`content_hash` text,
	`extracted_at` integer NOT NULL,
	FOREIGN KEY (`opportunity_id`) REFERENCES `opportunities`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`raw_signal_id`) REFERENCES `raw_signals`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `opportunity_evidence_opportunity_idx` ON `opportunity_evidence` (`opportunity_id`);--> statement-breakpoint
CREATE TABLE `raw_signals` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source_type` text NOT NULL,
	`source_url` text,
	`canonical_url` text,
	`title` text NOT NULL,
	`snippet` text NOT NULL,
	`published_at` integer,
	`fetched_at` integer NOT NULL,
	`content_hash` text,
	`availability` text NOT NULL,
	`last_verified_at` integer
);
--> statement-breakpoint
CREATE TABLE `signal_identities` (
	`kind` text NOT NULL,
	`value` text NOT NULL,
	`opportunity_id` integer NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`kind`, `value`),
	FOREIGN KEY (`opportunity_id`) REFERENCES `opportunities`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `signal_identities_opportunity_idx` ON `signal_identities` (`opportunity_id`);