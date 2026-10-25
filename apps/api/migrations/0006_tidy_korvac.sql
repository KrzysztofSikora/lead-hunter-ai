CREATE TABLE `payments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`opportunity_id` integer NOT NULL,
	`amount_minor` integer NOT NULL,
	`currency` text NOT NULL,
	`paid_at` integer NOT NULL,
	`note` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`opportunity_id`) REFERENCES `opportunities`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "amount_positive" CHECK("payments"."amount_minor" > 0),
	CONSTRAINT "currency_known" CHECK("payments"."currency" IN ('PLN', 'EUR', 'USD'))
);
--> statement-breakpoint
CREATE INDEX `payments_opportunity_idx` ON `payments` (`opportunity_id`,`paid_at`);--> statement-breakpoint
ALTER TABLE `opportunities` ADD `follow_up_at` integer;--> statement-breakpoint
CREATE INDEX `opportunities_follow_up_idx` ON `opportunities` (`follow_up_at`);