CREATE TABLE `deleted_usage` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`created_at` integer NOT NULL,
	`cost_micro_usd` integer,
	`counted` integer NOT NULL,
	`unknown_cost` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `deleted_usage_kind_created_idx` ON `deleted_usage` (`kind`,`created_at`);