import { Hono, type Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import { and, eq, inArray, max } from 'drizzle-orm';
import { parsePrUrl, type AddPrPreview, type DashboardResponse, type Me, type Settings, type Source } from '@mergewatch/shared';
import { db } from '../db/client.ts';
import { events, prSources, prs, sessions, trackedRepos, users } from '../db/schema.ts';
import { decrypt } from '../crypto.ts';
import { requireUser, type AppEnv, type User } from '../auth/session.ts';
import { disconnectJira } from '../auth/jira.ts';
import { GithubForbiddenError, GithubNotFoundError } from '../github/client.ts';
import { fetchPr, fetchPrsByIds, listMyRepos, type RepoSummary } from '../github/prs.ts';
import { mergePr, setAutoMerge } from '../github/merge.ts';
import { mergeReadiness } from '../sync/status.ts';
import { demoMerge } from '../demo/merge.ts';
import type { MergeMethod, PrSnapshot } from '@mergewatch/shared';
import { env } from '../env.ts';
import { DEMO_REPOS, demoLookup } from '../demo/fixtures.ts';
import { isSyncing, requestSync } from '../sync/poller.ts';
import { subscribe } from '../sync/stream.ts';
import { detailView, listViews } from '../views.ts';
import { hasSubscriptions, removeSubscription, saveSubscription, sendTestPush, vapidPublicKey } from '../push/send.ts';
import { MAX_SOUND_BYTES, playSound, saveCustomSound, soundPath, soundSupported, systemSounds } from '../push/sound.ts';
import { bodyLimit } from 'hono/body-limit';

export const api = new Hono<AppEnv>();
api.use('*', requireUser);

const token = (user: User) => decrypt(user.githubTokenEnc!);
const isDemoUser = (user: User) => env.demoMode && !user.githubTokenEnc;

async function lookupPr(user: User, owner: string, repo: string, number: number) {
  if (isDemoUser(user)) {
    const snap = demoLookup(owner, repo, number);
    if (snap === 'no_access') throw new GithubNotFoundError('demo');
    return snap;
  }
  return fetchPr(token(user), user.login, owner, repo, number);
}

async function availableRepos(user: User): Promise<RepoSummary[]> {
  if (isDemoUser(user)) return [...DEMO_REPOS, 'EnfluxInc/testament', 'EnfluxInc/data-pipeline'].map((fullName) => ({ fullName, private: true, pushedAt: null }));
  return listMyRepos(token(user));
}

function prId(c: Context<AppEnv>): number | null {
  const id = Number(c.req.param('id'));
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  const row = db.select({ id: prs.id }).from(prs).where(and(eq(prs.id, id), eq(prs.userId, c.get('user').id))).get();
  return row?.id ?? null;
}

async function body(c: Context<AppEnv>): Promise<Record<string, unknown>> {
  try {
    const value = await c.req.json();
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

api.get('/me', (c) => {
  const u = c.get('user');
  return c.json<Me>({ login: u.login, name: u.name, avatarUrl: u.avatarUrl, onboarded: u.onboarded });
});

api.get('/dashboard', (c) => {
  const u = c.get('user');
  const { prs: views, tickets } = listViews(u);
  const trackedRepoCount = db.select({ n: trackedRepos.fullName }).from(trackedRepos).where(eq(trackedRepos.userId, u.id)).all().length;
  return c.json<DashboardResponse>({
    connection: {
      github: u.githubStatus,
      jira: u.jiraStatus,
      lastSyncAt: u.lastSyncAt,
      rateLimitedUntil: u.rateLimitedUntil,
    },
    syncing: isSyncing(u.id) || !u.initialSyncDone,
    trackedRepoCount,
    prs: views,
    tickets,
  });
});

api.get('/prs/:id', (c) => {
  const id = prId(c);
  const detail = id ? detailView(c.get('user'), id) : null;
  return detail ? c.json(detail) : c.json({ error: 'not_found' }, 404);
});

function markSeen(id: number) {
  const latest = db.select({ maxId: max(events.id) }).from(events).where(eq(events.prId, id)).get();
  db.update(prs).set({ lastSeenEventId: latest?.maxId ?? 0 }).where(eq(prs.id, id)).run();
}

api.post('/prs/:id/seen', (c) => {
  const id = prId(c);
  if (!id) return c.json({ error: 'not_found' }, 404);
  markSeen(id);
  return c.json({ ok: true });
});

api.post('/prs/seen-all', (c) => {
  const rows = db
    .select({ id: prs.id, lastSeenEventId: prs.lastSeenEventId })
    .from(prs)
    .where(and(eq(prs.userId, c.get('user').id), eq(prs.dismissed, false)))
    .all();
  for (const r of rows) markSeen(r.id);
  return c.json({ previous: rows });
});

api.post('/prs/seen-restore', async (c) => {
  const { previous } = await body(c);
  if (!Array.isArray(previous) || previous.length > 1000) return c.json({ error: 'invalid' }, 400);
  const userId = c.get('user').id;
  const owned = new Set(db.select({ id: prs.id }).from(prs).where(eq(prs.userId, userId)).all().map((r) => r.id));
  for (const p of previous) {
    const id = Number((p as { id?: unknown })?.id);
    const seen = Number((p as { lastSeenEventId?: unknown })?.lastSeenEventId);
    if (!owned.has(id) || !Number.isSafeInteger(seen) || seen < 0) continue;
    db.update(prs).set({ lastSeenEventId: seen }).where(eq(prs.id, id)).run();
  }
  return c.json({ ok: true });
});

api.post('/prs/:id/mute', async (c) => {
  const id = prId(c);
  if (!id) return c.json({ error: 'not_found' }, 404);
  const { muted } = await body(c);
  db.update(prs).set({ muted: muted !== false }).where(eq(prs.id, id)).run();
  return c.json({ ok: true });
});

const METHODS: MergeMethod[] = ['merge', 'squash', 'rebase'];

/** The PR as GitHub has it right now; merge decisions never rely on the last poll. */
async function freshSnapshot(user: User, id: number): Promise<PrSnapshot | null> {
  const row = db.select().from(prs).where(eq(prs.id, id)).get();
  if (!row) return null;
  if (isDemoUser(user)) return row.snapshot as PrSnapshot;
  // Read-only: the stored snapshot stays as the differ last saw it, so the next sync still reports what changed.
  const [snap] = await fetchPrsByIds(token(user), user.login, [row.nodeId]);
  return snap ?? null;
}

api.post('/prs/:id/merge', async (c) => {
  const id = prId(c);
  if (!id) return c.json({ error: 'not_found' }, 404);
  const user = c.get('user');
  const { method, deleteBranch, sha } = await body(c);
  if (typeof method !== 'string' || !METHODS.includes(method as MergeMethod) || typeof sha !== 'string') {
    return c.json({ error: 'invalid' }, 400);
  }
  const snap = await freshSnapshot(user, id);
  if (!snap) return c.json({ error: 'not_found' }, 404);
  if (snap.headSha !== sha) return c.json({ error: 'changed', message: 'New commits were pushed since you opened this. Review them first.' }, 409);
  const readiness = mergeReadiness(snap);
  if (!readiness.ready) return c.json({ error: 'not_ready', message: readiness.reason }, 409);
  if (!snap.merge!.queue && !snap.merge!.methods.includes(method as MergeMethod)) {
    return c.json({ error: 'method_not_allowed', message: 'This repo doesn’t allow that merge method.' }, 400);
  }

  const outcome = isDemoUser(user)
    ? demoMerge(id, snap, method as MergeMethod)
    : await mergePr(token(user), snap, method as MergeMethod, deleteBranch === true);
  if (!outcome.ok) return c.json({ error: outcome.error, message: outcome.message }, 409);

  const how = { merge: 'merge commit', squash: 'squash', rebase: 'rebase' }[method as MergeMethod];
  const text = outcome.queued ? 'You added this to the merge queue from Mergewatch' : `You merged this from Mergewatch (${how})`;
  db.insert(events).values({ prId: id, type: 'merged_from_app', severity: 'noise', text, detail: outcome.branchDeleted ? `Deleted branch ${snap.headRef}` : null }).run();
  requestSync(user.id);
  return c.json(outcome);
});

api.post('/prs/:id/auto-merge', async (c) => {
  const id = prId(c);
  if (!id) return c.json({ error: 'not_found' }, 404);
  const user = c.get('user');
  const { enabled, method } = await body(c);
  if (typeof enabled !== 'boolean' || (enabled && (typeof method !== 'string' || !METHODS.includes(method as MergeMethod)))) {
    return c.json({ error: 'invalid' }, 400);
  }
  const snap = await freshSnapshot(user, id);
  if (!snap?.merge) return c.json({ error: 'not_found' }, 404);
  if (enabled && !snap.merge.autoMergeAllowed) return c.json({ error: 'not_allowed', message: 'Auto-merge is turned off in this repo’s GitHub settings.' }, 409);
  if (enabled && mergeReadiness(snap).ready) return c.json({ error: 'already_ready', message: 'This PR is ready now. Merge it directly.' }, 409);

  if (!isDemoUser(user)) {
    try {
      await setAutoMerge(token(user), snap, enabled, (method as MergeMethod) ?? snap.merge.defaultMethod);
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'unknown reason';
      return c.json({ error: 'failed', message: `GitHub refused: ${reason}` }, 409);
    }
  } else {
    const merge = { ...snap.merge, autoMerge: enabled ? { method: method as MergeMethod } : null };
    db.update(prs).set({ snapshot: { ...snap, merge } }).where(eq(prs.id, id)).run();
  }
  db.insert(events)
    .values({ prId: id, type: 'auto_merge_changed', severity: 'noise', text: enabled ? `You turned on auto-merge (${method})` : 'You turned off auto-merge' })
    .run();
  requestSync(user.id);
  return c.json({ ok: true });
});

api.post('/prs/:id/dismiss', (c) => {
  const id = prId(c);
  if (!id) return c.json({ error: 'not_found' }, 404);
  db.update(prs).set({ dismissed: true }).where(eq(prs.id, id)).run();
  return c.json({ ok: true });
});

api.post('/prs/:id/untrack', (c) => {
  const id = prId(c);
  if (!id) return c.json({ error: 'not_found' }, 404);
  db.delete(prSources).where(and(eq(prSources.prId, id), eq(prSources.source, 'manual'))).run();
  const remaining = db.select({ source: prSources.source }).from(prSources).where(eq(prSources.prId, id)).all();
  if (remaining.length === 0) db.update(prs).set({ dismissed: true }).where(eq(prs.id, id)).run();
  return c.json({ ok: true });
});

async function previewPr(user: User, url: unknown): Promise<AddPrPreview> {
  const ref = typeof url === 'string' ? parsePrUrl(url) : null;
  if (!ref) return { result: 'invalid' };
  let snap;
  try {
    snap = await lookupPr(user, ref.owner, ref.repo, ref.number);
  } catch (err) {
    if (err instanceof GithubNotFoundError || err instanceof GithubForbiddenError) return { result: 'no_access' };
    throw err;
  }
  if (!snap) return { result: 'no_access' };
  const existing = db.select().from(prs).where(and(eq(prs.userId, user.id), eq(prs.nodeId, snap.nodeId), eq(prs.dismissed, false))).get();
  if (existing) {
    const via = db.select({ source: prSources.source }).from(prSources).where(eq(prSources.prId, existing.id)).all().map((s) => s.source);
    return { result: 'tracked', id: String(existing.id), via: [...new Set(via)] as Source[] };
  }
  if (snap.state !== 'open') return { result: 'closed', repo: snap.repo, number: snap.number, title: snap.title };
  return {
    result: 'valid',
    repo: snap.repo,
    number: snap.number,
    title: snap.title,
    author: snap.author,
    openedByMe: snap.author.toLowerCase() === user.login.toLowerCase(),
  };
}

api.post('/prs/preview', async (c) => c.json(await previewPr(c.get('user'), (await body(c)).url)));

api.post('/prs', async (c) => {
  const user = c.get('user');
  const { url } = await body(c);
  const preview = await previewPr(user, url);
  if (preview.result !== 'valid') return c.json(preview, 409);
  const ref = parsePrUrl(url as string)!;
  const snap = (await lookupPr(user, ref.owner, ref.repo, ref.number))!;

  const id = db.transaction((tx) => {
    const existing = tx.select({ id: prs.id }).from(prs).where(and(eq(prs.userId, user.id), eq(prs.nodeId, snap.nodeId))).get();
    const prIdValue = existing
      ? (tx.update(prs).set({ dismissed: false, muted: false }).where(eq(prs.id, existing.id)).run(), existing.id)
      : tx
          .insert(prs)
          .values({ userId: user.id, nodeId: snap.nodeId, repo: snap.repo, number: snap.number, snapshot: snap, snapshotHash: '' })
          .returning({ id: prs.id })
          .get().id;
    tx.insert(prSources).values({ prId: prIdValue, source: 'manual' }).onConflictDoNothing().run();
    const ev = tx.insert(events).values({ prId: prIdValue, type: 'added_manually', severity: 'info', text: 'Added by you from a GitHub link' }).returning({ id: events.id }).get();
    tx.update(prs).set({ lastSeenEventId: ev.id }).where(eq(prs.id, prIdValue)).run();
    return prIdValue;
  });
  requestSync(user.id);
  return c.json({ id: String(id) }, 201);
});

const REPO_NAME = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

api.get('/repos', async (c) => {
  const user = c.get('user');
  const rows = db.select({ n: trackedRepos.fullName, watchAll: trackedRepos.watchAll }).from(trackedRepos).where(eq(trackedRepos.userId, user.id)).all();
  const tracked = new Set(rows.map((r) => r.n));
  const watchAll = new Set(rows.filter((r) => r.watchAll).map((r) => r.n));
  const available = await availableRepos(user);
  const names = new Set(available.map((r) => r.fullName));
  // Keep tracked repos visible even if GitHub stopped listing them, so they can be removed.
  for (const t of tracked) if (!names.has(t)) available.push({ fullName: t, private: true, pushedAt: null });
  return c.json(available.map((r) => ({ ...r, tracked: tracked.has(r.fullName), watchAll: watchAll.has(r.fullName) })));
});

api.put('/repos', async (c) => {
  const user = c.get('user');
  const { repos, watchAll } = await body(c);
  if (!Array.isArray(repos) || repos.length > 300 || !repos.every((r) => typeof r === 'string' && REPO_NAME.test(r))) {
    return c.json({ error: 'invalid' }, 400);
  }
  if (watchAll !== undefined && (!Array.isArray(watchAll) || !watchAll.every((r) => typeof r === 'string' && repos.includes(r)))) {
    return c.json({ error: 'invalid_watch_all' }, 400);
  }
  // Omitted means "leave watch-all as it was", so older callers (onboarding) don't reset it.
  const previousWatch = new Set(
    db.select({ n: trackedRepos.fullName }).from(trackedRepos).where(and(eq(trackedRepos.userId, user.id), eq(trackedRepos.watchAll, true))).all().map((r) => r.n),
  );
  const watchSet = new Set((watchAll as string[] | undefined) ?? [...previousWatch]);
  const allowed = new Set((await availableRepos(user)).map((r) => r.fullName));
  const current = new Set(db.select({ n: trackedRepos.fullName }).from(trackedRepos).where(eq(trackedRepos.userId, user.id)).all().map((r) => r.n));
  const wanted = (repos as string[]).filter((r) => allowed.has(r) || current.has(r));
  db.transaction((tx) => {
    tx.delete(trackedRepos).where(eq(trackedRepos.userId, user.id)).run();
    for (const fullName of new Set(wanted)) tx.insert(trackedRepos).values({ userId: user.id, fullName, watchAll: watchSet.has(fullName) }).run();
  });
  requestSync(user.id);
  return c.json({ tracked: wanted.length });
});

function settingsOf(u: User): Settings & { jiraSite: string | null; githubLogin: string } {
  return {
    staleDays: u.staleDays,
    quietHoursStart: u.quietHoursStart,
    quietHoursEnd: u.quietHoursEnd,
    jiraProjects: u.jiraProjects,
    autoAttributeJira: u.autoAttributeJira,
    desktopNotifications: u.desktopNotifications,
    slackNotifications: u.slackNotifications,
    notificationSound: u.notificationSound,
    customSoundName: u.customSoundName,
    jiraSite: u.jiraSiteUrl ? new URL(u.jiraSiteUrl).host : null,
    githubLogin: u.login,
  };
}

api.get('/settings', (c) => c.json(settingsOf(c.get('user'))));

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const PROJECT = /^[A-Z][A-Z0-9]{1,9}$/;

api.put('/settings', async (c) => {
  const user = c.get('user');
  const b = await body(c);
  const patch: Partial<typeof users.$inferInsert> = {};
  if (b.staleDays !== undefined) {
    const n = Number(b.staleDays);
    if (!Number.isInteger(n) || n < 1 || n > 60) return c.json({ error: 'invalid_stale_days' }, 400);
    patch.staleDays = n;
  }
  for (const key of ['quietHoursStart', 'quietHoursEnd'] as const) {
    if (b[key] === undefined) continue;
    if (b[key] !== null && !(typeof b[key] === 'string' && TIME.test(b[key] as string))) return c.json({ error: `invalid_${key}` }, 400);
    patch[key] = b[key] as string | null;
  }
  if (b.jiraProjects !== undefined) {
    if (!Array.isArray(b.jiraProjects) || b.jiraProjects.length > 20 || !b.jiraProjects.every((p) => typeof p === 'string' && PROJECT.test(p))) {
      return c.json({ error: 'invalid_jira_projects' }, 400);
    }
    patch.jiraProjects = b.jiraProjects as string[];
  }
  for (const key of ['autoAttributeJira', 'desktopNotifications', 'slackNotifications'] as const) {
    if (b[key] === undefined) continue;
    if (typeof b[key] !== 'boolean') return c.json({ error: `invalid_${key}` }, 400);
    patch[key] = b[key] as boolean;
  }
  if (b.notificationSound !== undefined) {
    const v = b.notificationSound;
    const ok =
      v === 'default' ||
      (typeof v === 'string' && v.startsWith('system:') && systemSounds().includes(v.slice('system:'.length))) ||
      (v === 'custom' && !!user.customSoundFile);
    if (!ok) return c.json({ error: 'invalid_notification_sound' }, 400);
    patch.notificationSound = v as string;
  }
  if (Object.keys(patch).length) db.update(users).set(patch).where(eq(users.id, user.id)).run();
  const updated = db.select().from(users).where(eq(users.id, user.id)).get()!;
  if (patch.jiraProjects || patch.autoAttributeJira !== undefined || patch.staleDays) requestSync(user.id);
  return c.json(settingsOf(updated));
});

api.post('/onboarding/complete', (c) => {
  db.update(users).set({ onboarded: true }).where(eq(users.id, c.get('user').id)).run();
  return c.json({ ok: true });
});

api.post('/jira/disconnect', (c) => {
  const userId = c.get('user').id;
  disconnectJira(userId);
  const jiraOnly = db
    .select({ prId: prSources.prId })
    .from(prSources)
    .innerJoin(prs, eq(prs.id, prSources.prId))
    .where(and(eq(prs.userId, userId), eq(prSources.source, 'jira')))
    .all()
    .map((r) => r.prId);
  if (jiraOnly.length) db.delete(prSources).where(and(inArray(prSources.prId, jiraOnly), eq(prSources.source, 'jira'))).run();
  requestSync(userId);
  return c.json({ ok: true });
});

api.get('/push', (c) => c.json({ publicKey: vapidPublicKey(), subscriptions: hasSubscriptions(c.get('user').id) }));

const B64URL = /^[A-Za-z0-9_-]+={0,2}$/;

api.post('/push/subscribe', async (c) => {
  const { endpoint, keys } = await body(c);
  const k = keys as { p256dh?: unknown; auth?: unknown } | undefined;
  let url: URL | null = null;
  try {
    url = typeof endpoint === 'string' && endpoint.length < 1000 ? new URL(endpoint) : null;
  } catch {
    url = null;
  }
  if (!url || url.protocol !== 'https:' || typeof k?.p256dh !== 'string' || typeof k?.auth !== 'string' || !B64URL.test(k.p256dh) || !B64URL.test(k.auth)) {
    return c.json({ error: 'invalid_subscription' }, 400);
  }
  saveSubscription(c.get('user').id, { endpoint: url.toString(), keys: { p256dh: k.p256dh, auth: k.auth } });
  return c.json({ ok: true });
});

api.post('/push/unsubscribe', async (c) => {
  const { endpoint } = await body(c);
  if (typeof endpoint === 'string') removeSubscription(c.get('user').id, endpoint);
  return c.json({ ok: true });
});

api.post('/push/test', async (c) => {
  await sendTestPush(c.get('user'));
  return c.json({ ok: true });
});

api.get('/sounds', (c) => c.json({ supported: soundSupported(), system: systemSounds() }));

api.post(
  '/sound',
  bodyLimit({ maxSize: MAX_SOUND_BYTES, onError: (c) => c.json({ error: 'too_large' }, 413) }),
  async (c) => {
    if (!soundSupported()) return c.json({ error: 'unsupported' }, 400);
    const user = c.get('user');
    const data = new Uint8Array(await c.req.arrayBuffer());
    let file: string;
    try {
      file = saveCustomSound(user.id, data);
    } catch {
      return c.json({ error: 'not_audio' }, 400);
    }
    const name = (c.req.header('x-file-name') ?? 'Custom sound').replace(/[^\w .()-]/g, '').slice(0, 80) || 'Custom sound';
    db.update(users).set({ customSoundFile: file, customSoundName: name, notificationSound: 'custom' }).where(eq(users.id, user.id)).run();
    playSound(soundPath('custom', file));
    return c.json({ ok: true, name });
  },
);

api.post('/sound/preview', async (c) => {
  const user = c.get('user');
  const { sound } = await body(c);
  if (typeof sound !== 'string') return c.json({ error: 'invalid' }, 400);
  playSound(soundPath(sound, user.customSoundFile));
  return c.json({ ok: true });
});

/** Forgets the GitHub token and ends every session; the user signs in again to reconnect. */
api.post('/github/disconnect', (c) => {
  const userId = c.get('user').id;
  db.update(users).set({ githubTokenEnc: null }).where(eq(users.id, userId)).run();
  db.delete(sessions).where(eq(sessions.userId, userId)).run();
  return c.json({ ok: true });
});

api.post('/sync', (c) => {
  requestSync(c.get('user').id);
  return c.json({ ok: true });
});

api.get('/stream', (c) => {
  const userId = c.get('user').id;
  return streamSSE(c, async (stream) => {
    let closed = false;
    const unsubscribe = subscribe(userId, (msg) => {
      void stream.writeSSE({ event: 'sync', data: JSON.stringify(msg) });
    });
    stream.onAbort(() => {
      closed = true;
      unsubscribe();
    });
    while (!closed) {
      await stream.writeSSE({ event: 'ping', data: '' });
      await stream.sleep(25_000);
    }
  });
});
