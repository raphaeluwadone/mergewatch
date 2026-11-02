ALTER TABLE `users` ADD `rattle_url` text;--> statement-breakpoint
ALTER TABLE `users` ADD `rattle_token_enc` text;--> statement-breakpoint
ALTER TABLE `users` ADD `rattle_email` text;--> statement-breakpoint
ALTER TABLE `users` ADD `rattle_status` text DEFAULT 'not_connected' NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `rattle_last_push_at` text;