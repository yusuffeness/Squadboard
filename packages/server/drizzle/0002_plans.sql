ALTER TABLE `requests` ADD `status` text;--> statement-breakpoint
ALTER TABLE `requests` ADD `error` text;--> statement-breakpoint
ALTER TABLE `requests` ADD `error_detail` text;--> statement-breakpoint
ALTER TABLE `requests` ADD `steps` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `requests` ADD `planner_cost_usd` real;--> statement-breakpoint
ALTER TABLE `requests` ADD `approved_at` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD `prompt` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD `blocked_reason` text;