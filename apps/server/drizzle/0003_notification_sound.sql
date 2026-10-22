ALTER TABLE `users` ADD `notification_sound` text DEFAULT 'default' NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `custom_sound_file` text;--> statement-breakpoint
ALTER TABLE `users` ADD `custom_sound_name` text;