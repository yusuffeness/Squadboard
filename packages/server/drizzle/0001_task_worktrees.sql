ALTER TABLE `tasks` ADD `base_ref` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD `base_commit` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD `changed_files` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `tasks` ADD `unexpected_files` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `tasks` ADD `git_error` text;--> statement-breakpoint
CREATE UNIQUE INDEX `projects_path_idx` ON `projects` (`path`);