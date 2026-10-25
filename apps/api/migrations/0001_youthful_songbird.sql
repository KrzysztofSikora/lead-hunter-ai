CREATE TABLE `sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL
);
