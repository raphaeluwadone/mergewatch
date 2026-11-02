import { Hono, type MiddlewareHandler } from 'hono';
import { and, eq, lt } from 'drizzle-orm';
import { db } from '../db/client.ts';
import { prs, users } from '../db/schema.ts';
import { sha256 } from '../crypto.ts';
import type { User } from '../auth/session.ts';
import { pushToRattle } from './push.ts';

export const CALLBACK_PREFIX = 'mw_rattle_';

type InboundEnv = { Variables: { user: User } };

const bearer: MiddlewareHandler<InboundEnv> = async (c, next) => {
  const token = c.req.header('authorization')?.match(/^Bearer\s+(\S+)$/i)?.[1];
  const user = token?.startsWith(CALLBACK_PREFIX) ? db.select().from(users).where(eq(users.rattleCallbackHash, sha256(token))).get() : undefined;
  if (!user) return c.json({ error: 'unauthenticated' }, 401);
  c.set('user', user);
  await next();
};

/** Calls from Rattle's server, authenticated by the callback token handed over when the user connected. */
export const rattleInbound = new Hono<InboundEnv>()
  .use(bearer)

  // Marks seen only up to the event Rattle was showing, so anything newer stays unread.
  .post('/prs/:id/seen', async (c) => {
    const user = c.get('user');
    const id = Number(c.req.param('id'));
    let eventId: unknown;
    try {
      eventId = ((await c.req.json()) as { eventId?: unknown }).eventId;
    } catch {
      eventId = undefined;
    }
    if (!Number.isSafeInteger(id) || !Number.isSafeInteger(eventId) || (eventId as number) < 0) return c.json({ error: 'invalid' }, 400);
    const row = db.select({ id: prs.id }).from(prs).where(and(eq(prs.id, id), eq(prs.userId, user.id))).get();
    if (!row) return c.json({ error: 'not_found' }, 404);
    // Only ever moves forward: seeing it in Mergewatch first shouldn't be undone.
    db.update(prs)
      .set({ lastSeenEventId: eventId as number })
      .where(and(eq(prs.id, id), lt(prs.lastSeenEventId, eventId as number)))
      .run();
    void pushToRattle(user).catch((err) => console.error('Rattle push failed:', err));
    return c.json({ ok: true });
  });
