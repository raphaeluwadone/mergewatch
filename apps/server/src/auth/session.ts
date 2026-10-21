import type { Context, MiddlewareHandler } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { and, eq, gt, lt } from 'drizzle-orm';
import { db } from '../db/client.ts';
import { sessions, users } from '../db/schema.ts';
import { randomToken, sha256 } from '../crypto.ts';
import { env } from '../env.ts';

export type User = typeof users.$inferSelect;
export type AppEnv = { Variables: { user: User } };

const COOKIE = 'mw_session';
const TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function startSession(c: Context, userId: number) {
  const raw = randomToken();
  const expiresAt = new Date(Date.now() + TTL_MS);
  db.insert(sessions).values({ idHash: sha256(raw), userId, expiresAt: expiresAt.toISOString() }).run();
  setCookie(c, COOKIE, raw, {
    httpOnly: true,
    secure: env.isProduction,
    sameSite: 'Lax',
    path: '/',
    expires: expiresAt,
  });
}

export function endSession(c: Context) {
  const raw = getCookie(c, COOKIE);
  if (raw) db.delete(sessions).where(eq(sessions.idHash, sha256(raw))).run();
  deleteCookie(c, COOKIE, { path: '/' });
}

export function sessionUser(c: Context): User | null {
  const raw = getCookie(c, COOKIE);
  if (!raw) return null;
  const row = db
    .select({ user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.idHash, sha256(raw)), gt(sessions.expiresAt, new Date().toISOString())))
    .get();
  return row?.user ?? null;
}

export function pruneExpiredSessions() {
  db.delete(sessions).where(lt(sessions.expiresAt, new Date().toISOString())).run();
}

export const requireUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  const user = sessionUser(c);
  if (!user) return c.json({ error: 'unauthenticated' }, 401);
  c.set('user', user);
  await next();
};

/** Cross-site forms can't set custom headers, so requiring one blocks CSRF on state-changing calls. */
export const requireAppHeader: MiddlewareHandler = async (c, next) => {
  if (c.req.method !== 'GET' && c.req.header('x-mergewatch') !== '1') {
    return c.json({ error: 'missing_app_header' }, 403);
  }
  await next();
};
