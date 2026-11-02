import { and, eq, inArray, max, ne } from 'drizzle-orm';
import type { PrView, RattleConnection } from '@mergewatch/shared';
import { db } from '../db/client.ts';
import { events, users } from '../db/schema.ts';
import { decrypt } from '../crypto.ts';
import type { User } from '../auth/session.ts';
import { listViews } from '../views.ts';

/** Rattle rejects bigger pushes; its body limit is 64 KB. */
const MAX_PRS = 100;
const TIMEOUT_MS = 10_000;

export class RattleAuthError extends Error {}

export function rattleConnection(u: User): RattleConnection {
  return { url: u.rattleUrl, status: u.rattleStatus, email: u.rattleEmail, lastPushAt: u.rattleLastPushAt };
}

/** Calls Rattle's inbound API. Throws RattleAuthError on 401, Error on anything else that fails. */
export async function rattleFetch(baseUrl: string, token: string, path: string, init: { method?: string; body?: unknown } = {}): Promise<Response> {
  const res = await fetch(new URL(`/api/inbound/mergewatch${path}`, baseUrl), {
    method: init.method ?? 'GET',
    headers: { authorization: `Bearer ${token}`, ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (res.status === 401) throw new RattleAuthError('Rattle rejected the token');
  if (!res.ok) throw new Error(`Rattle returned ${res.status}`);
  return res;
}

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** What Rattle shows: PRs that need the user or are waiting on others, most urgent section first. */
export function rattlePayload(views: PrView[], latestEvent: Map<string, number>) {
  return views
    .filter((v) => !v.muted && (v.section === 'needs' || v.section === 'waiting'))
    .sort((a, b) => (a.section === b.section ? b.lastActivityAt.localeCompare(a.lastActivityAt) : a.section === 'needs' ? -1 : 1))
    .slice(0, MAX_PRS)
    .map((v) => ({
      id: v.id,
      repo: v.repo,
      number: v.number,
      title: clip(v.title, 500),
      url: v.url,
      status: v.status,
      section: v.section,
      role: v.role,
      reason: clip(v.detail ?? '', 300),
      unreadCount: v.unreadCount,
      latestEventId: latestEvent.get(v.id) ?? 0,
      lastActivityAt: v.lastActivityAt,
    }));
}

function latestEventIds(prIds: number[]): Map<string, number> {
  if (!prIds.length) return new Map();
  const rows = db
    .select({ prId: events.prId, id: max(events.id) })
    .from(events)
    .where(and(inArray(events.prId, prIds), ne(events.severity, 'noise')))
    .groupBy(events.prId)
    .all();
  return new Map(rows.map((r) => [String(r.prId), r.id ?? 0]));
}

/** Sends the current set to Rattle and records how it went. A failed push is retried by the next sync. */
export async function pushToRattle(user: User): Promise<void> {
  if (!user.rattleUrl || !user.rattleTokenEnc) return;
  const views = listViews(user).prs;
  const prs = rattlePayload(views, latestEventIds(views.map((v) => Number(v.id))));
  let status: User['rattleStatus'] = 'connected';
  try {
    await rattleFetch(user.rattleUrl, decrypt(user.rattleTokenEnc), '/prs', { method: 'PUT', body: { prs } });
  } catch (err) {
    status = err instanceof RattleAuthError ? 'unauthorized' : 'error';
    if (status === 'error') console.error('Rattle push failed:', err);
  }
  db.update(users)
    .set({ rattleStatus: status, ...(status === 'connected' ? { rattleLastPushAt: new Date().toISOString() } : {}) })
    .where(eq(users.id, user.id))
    .run();
}
