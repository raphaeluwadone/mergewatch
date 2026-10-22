import { serve } from '@hono/node-server';
import { env } from './env.ts';
import { runMigrations } from './db/client.ts';
import { app } from './app.ts';
import { startPoller } from './sync/poller.ts';
import { pruneExpiredSessions } from './auth/session.ts';

runMigrations();
pruneExpiredSessions();
// Syncs only users with a GitHub token, so the demo user is never polled.
startPoller();

// Bound to loopback: the Vite dev server proxies to it, and nothing else should reach it.
serve({ fetch: app.fetch, port: env.port, hostname: '127.0.0.1' }, (info) => {
  console.log(`Mergewatch API on http://127.0.0.1:${info.port}${env.demoMode ? ' (demo mode)' : ''}`);
});
