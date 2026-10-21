CREATE TABLE `analyses` (
	`pr_id` integer NOT NULL,
	`head_sha` text NOT NULL,
	`check_name` text NOT NULL,
	`status` text NOT NULL,
	`category` text,
	`confidence` text,
	`text` text,
	`log_excerpt` text DEFAULT '[]' NOT NULL,
	`log_url` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	PRIMARY KEY(`pr_id`, `head_sha`, `check_name`),
	FOREIGN KEY (`pr_id`) REFERENCES `prs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`pr_id` integer NOT NULL,
	`type` text NOT NULL,
	`severity` text NOT NULL,
	`text` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`pr_id`) REFERENCES `prs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `events_pr` ON `events` (`pr_id`,`id`);--> statement-breakpoint
CREATE TABLE `oauth_states` (
	`state` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`user_id` integer,
	`expires_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `pr_sources` (
	`pr_id` integer NOT NULL,
	`source` text NOT NULL,
	`jira_key` text DEFAULT '' NOT NULL,
	PRIMARY KEY(`pr_id`, `source`, `jira_key`),
	FOREIGN KEY (`pr_id`) REFERENCES `prs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `prs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`node_id` text NOT NULL,
	`repo` text NOT NULL,
	`number` integer NOT NULL,
	`snapshot` text NOT NULL,
	`snapshot_hash` text NOT NULL,
	`last_seen_event_id` integer DEFAULT 0 NOT NULL,
	`muted` integer DEFAULT false NOT NULL,
	`dismissed` integer DEFAULT false NOT NULL,
	`last_stale_at` text,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `prs_user_node` ON `prs` (`user_id`,`node_id`);--> statement-breakpoint
CREATE INDEX `prs_user` ON `prs` (`user_id`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id_hash` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`expires_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `tickets` (
	`user_id` integer NOT NULL,
	`key` text NOT NULL,
	`title` text NOT NULL,
	`status` text NOT NULL,
	`status_category` text NOT NULL,
	`assignee` text,
	`assigned_to_me` integer NOT NULL,
	`url` text,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	PRIMARY KEY(`user_id`, `key`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `tracked_repos` (
	`user_id` integer NOT NULL,
	`full_name` text NOT NULL,
	PRIMARY KEY(`user_id`, `full_name`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`github_id` integer NOT NULL,
	`login` text NOT NULL,
	`name` text,
	`avatar_url` text,
	`github_token_enc` text,
	`github_status` text DEFAULT 'ok' NOT NULL,
	`rate_limited_until` text,
	`jira_access_enc` text,
	`jira_refresh_enc` text,
	`jira_expires_at` text,
	`jira_cloud_id` text,
	`jira_site_url` text,
	`jira_account_id` text,
	`jira_status` text DEFAULT 'not_connected' NOT NULL,
	`onboarded` integer DEFAULT false NOT NULL,
	`initial_sync_done` integer DEFAULT false NOT NULL,
	`last_sync_at` text,
	`stale_days` integer DEFAULT 3 NOT NULL,
	`quiet_hours_start` text,
	`quiet_hours_end` text,
	`jira_projects` text DEFAULT '[]' NOT NULL,
	`auto_attribute_jira` integer DEFAULT true NOT NULL,
	`desktop_notifications` integer DEFAULT true NOT NULL,
	`slack_notifications` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_github_id_unique` ON `users` (`github_id`);