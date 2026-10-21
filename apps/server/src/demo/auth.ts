import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { db } from '../db/client.ts';
import { users } from '../db/schema.ts';
import { startSession } from '../auth/session.ts';
import { DEMO_LOGIN } from './fixtures.ts';

/** Only mounted when DEMO_MODE=1. Signs in as the seeded demo user without GitHub. */
export const demoAuth = new Hono();

demoAuth.post('/demo', (c) => {
  const user = db.select({ id: users.id }).from(users).where(eq(users.login, DEMO_LOGIN)).get();
  if (!user) return c.json({ error: 'run pnpm seed:demo first' }, 404);
  startSession(c, user.id);
  return c.json({ ok: true });
});
