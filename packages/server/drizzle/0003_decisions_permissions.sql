CREATE TABLE `permission_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`run_id` text NOT NULL,
	`tool` text NOT NULL,
	`input` text NOT NULL,
	`rule` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`answered_at` text,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `permission_requests_task_idx` ON `permission_requests` (`task_id`);--> statement-breakpoint
ALTER TABLE `decisions` ADD `run_id` text;--> statement-breakpoint
ALTER TABLE `decisions` ADD `multi_select` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `decisions` ADD `problem` text;