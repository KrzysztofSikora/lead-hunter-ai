CREATE TABLE `activity_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`opportunity_id` integer NOT NULL,
	`type` text NOT NULL,
	`actor` text NOT NULL,
	`from_status` text,
	`to_status` text,
	`reason` text,
	`note` text,
	`metadata_json` text,
	`occurred_at` integer NOT NULL,
	FOREIGN KEY (`opportunity_id`) REFERENCES `opportunities`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `activity_events_opportunity_idx` ON `activity_events` (`opportunity_id`,`occurred_at`);