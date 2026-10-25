CREATE TABLE `job_locks` (
	`name` text PRIMARY KEY NOT NULL,
	`owner_host` text NOT NULL,
	`owner_pid` integer NOT NULL,
	`owner_token` text NOT NULL,
	`acquired_at` integer NOT NULL,
	`heartbeat_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `job_runs` ADD `trigger` text;--> statement-breakpoint
ALTER TABLE `job_runs` ADD `parent_run_id` integer REFERENCES job_runs(id);--> statement-breakpoint
ALTER TABLE `job_runs` ADD `scheduled_for` integer;--> statement-breakpoint
ALTER TABLE `job_runs` ADD `skipped` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `job_runs_slot_uq` ON `job_runs` (`job_type`,`scheduled_for`);--> statement-breakpoint
CREATE INDEX `job_runs_parent_idx` ON `job_runs` (`parent_run_id`);--> statement-breakpoint
CREATE INDEX `job_runs_started_idx` ON `job_runs` (`started_at`);--> statement-breakpoint
ALTER TABLE `raw_signals` ADD `job_run_id` integer REFERENCES job_runs(id);--> statement-breakpoint
CREATE INDEX `raw_signals_job_run_idx` ON `raw_signals` (`job_run_id`);