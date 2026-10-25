CREATE TABLE `operator_profile` (
	`id` integer PRIMARY KEY NOT NULL,
	`schema_version` integer NOT NULL,
	`data` text NOT NULL,
	`is_example` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "single_row" CHECK("operator_profile"."id" = 1)
);
