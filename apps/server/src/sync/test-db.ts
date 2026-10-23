// Test helper: one import for the database and its config, plus cleanup of the throwaway file.
import fs from 'node:fs';
import { afterAll } from 'vitest';
import { env } from '../env.ts';
import { db, runMigrations } from '../db/client.ts';

afterAll(() => {
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(`${env.databasePath}${suffix}`, { force: true });
});

export { db, env, runMigrations };
