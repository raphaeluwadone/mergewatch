ALTER TABLE `users` ADD `rattle_callback_hash` text;--> statement-breakpoint
CREATE UNIQUE INDEX `users_rattle_callback_hash_unique` ON `users` (`rattle_callback_hash`);