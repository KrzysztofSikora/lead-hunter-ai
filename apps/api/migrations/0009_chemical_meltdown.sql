ALTER TABLE `analyses` ADD `cost_micro_usd` integer;--> statement-breakpoint
ALTER TABLE `analyses` ADD `reused_from_analysis_id` integer REFERENCES analyses(id) ON DELETE set null;--> statement-breakpoint
ALTER TABLE `opportunities` ADD `analysis_force` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX `raw_signals_content_hash_idx` ON `raw_signals` (`content_hash`);