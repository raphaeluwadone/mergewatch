import { and, eq, inArray, isNotNull, max, ne } from 'drizzle-orm';
import { extractJiraKeys, type PrSnapshot, type Source, type StreamMessage } from '@mergewatch/shared';
import { db } from '../db/client.ts';
import { events, prSources, prs, tickets, trackedRepos, users } from '../db/schema.ts';
import { decrypt, sha256 } from '../crypto.ts';
import { env } from '../env.ts';
import type { User } from '../auth/session.ts';
import { GithubAuthError, GithubRateLimitError } from '../github/client.ts';
import { fetchPrsByIds, listOpenPrHeads, searchMyPrs } from '../github/prs.ts';
import { assignedIssues, getIssue, JiraAuthError, type JiraIssue } from '../jira/client.ts';
import { analyzeFailures } from '../agent/analyze.ts';
import { diffSnapshots, type DiffEvent } from './differ.ts';
import { deriveRole } from './status.ts';
import { publish } from './stream.ts';

const inFlight = new Set<number>();
const queued = new Set<number>();

export const isSyncing = (userId: number) => inFlight.has(userId);

export function requestSync(userId: number) {
  if (inFlight.has(userId)) queued.add(userId);
  else void syncUser(userId);
}

export function startPoller() {
  const tick = async () => {
    const due = db
      .select({ id: users.id, rateLimitedUntil: users.rateLimitedUntil })
      .from(users)
      .where(and(isNotNull(users.githubTokenEnc), ne(users.githubStatus, 'expired')))
      .all();
    for (const u of due) {
      if (u.rateLimitedUntil && new Date(u.rateLimitedUntil) > new Date()) continue;
      await syncUser(u.id);
    }
  };
  setTimeout(() => void tick(), 1_000);
  return setInterval(() => void tick(), env.pollIntervalMs);
}

export async function syncUser(userId: number) {
  if (inFlight.has(userId)) {
    queued.add(userId);
    return;
  }
  inFlight.add(userId);
  try {
    const user = db.select().from(users).where(eq(users.id, userId)).get();
    if (user?.githubTokenEnc) await sync(user, decrypt(user.githubTokenEnc));
  } catch (err) {
    if (err instanceof GithubAuthError) {
      db.update(users).set({ githubStatus: 'expired' }).where(eq(users.id, userId)).run();
    } else if (err instanceof GithubRateLimitError) {
      db.update(users).set({ githubStatus: 'rate_limited', rateLimitedUntil: err.resetAt.toISOString() }).where(eq(users.id, userId)).run();
    } else {
      console.error(`Sync failed for user ${userId}:`, err);
    }
    publish(userId, { type: 'sync', attention: [] });
  } finally {
    inFlight.delete(userId);
    if (queued.delete(userId)) void syncUser(userId);
  }
}

interface Attribution {
  auto: boolean;
  manual: boolean;
  jiraKeys: Set<string>;
}

const iReviewed = (snap: PrSnapshot, login: string) => snap.reviews.some((r) => r.reviewer.toLowerCase() === login.toLowerCase());

async function sync(user: User, token: string) {
  const now = new Date();
  const login = user.login;
  const tracked = new Set(
    db.select({ name: trackedRepos.fullName }).from(trackedRepos).where(eq(trackedRepos.userId, user.id)).all().map((r) => r.name.toLowerCase()),
  );
  const isTracked = (repo: string) => tracked.has(repo.toLowerCase());

  const snapshots = new Map<string, PrSnapshot>();
  const attribution = new Map<string, Attribution>();
  const attr = (nodeId: string) => {
    let a = attribution.get(nodeId);
    if (!a) attribution.set(nodeId, (a = { auto: false, manual: false, jiraKeys: new Set() }));
    return a;
  };

  for (const snap of await searchMyPrs(token, login)) {
    if (!isTracked(snap.repo)) continue;
    snapshots.set(snap.nodeId, snap);
    attr(snap.nodeId).auto = true;
  }

  const rows = db.select().from(prs).where(eq(prs.userId, user.id)).all();
  const rowByNode = new Map(rows.map((r) => [r.nodeId, r]));
  const prevSources = db
    .select({ prId: prSources.prId, source: prSources.source, jiraKey: prSources.jiraKey })
    .from(prSources)
    .innerJoin(prs, eq(prs.id, prSources.prId))
    .where(eq(prs.userId, user.id))
    .all();
  const prevSourcesByPr = new Map<number, typeof prevSources>();
  for (const s of prevSources) prevSourcesByPr.set(s.prId, [...(prevSourcesByPr.get(s.prId) ?? []), s]);
  for (const row of rows) {
    if ((prevSourcesByPr.get(row.id) ?? []).some((s) => s.source === 'manual')) attr(row.nodeId).manual = true;
  }

  // Jira: tickets assigned to the user, and the open PRs in tracked repos that mention them.
  let assigned: JiraIssue[] | null = null;
  if (user.jiraStatus === 'connected') {
    try {
      assigned = await assignedIssues(user);
    } catch (err) {
      if (!(err instanceof JiraAuthError)) console.error('Jira search failed:', err);
    }
  }
  const assignedByKey = new Map((assigned ?? []).map((i) => [i.key, i]));
  if (assigned && user.autoAttributeJira && assignedByKey.size > 0) {
    for (const repo of tracked) {
      for (const head of await listOpenPrHeads(token, repo)) {
        for (const key of extractJiraKeys(head.headRefName, head.title)) {
          if (assignedByKey.has(key)) attr(head.id).jiraKeys.add(key);
        }
      }
    }
  }

  // Refresh everything we track that the searches didn't return, so merges and closes are seen.
  const toRefresh = new Set<string>();
  for (const [nodeId, a] of attribution) if (!snapshots.has(nodeId) && (a.manual || a.jiraKeys.size)) toRefresh.add(nodeId);
  for (const row of rows) if (!row.dismissed && !snapshots.has(row.nodeId)) toRefresh.add(row.nodeId);
  for (const snap of await fetchPrsByIds(token, login, [...toRefresh])) {
    snapshots.set(snap.nodeId, snap);
    const row = rowByNode.get(snap.nodeId);
    const wasAuto = row && (prevSourcesByPr.get(row.id) ?? []).some((s) => s.source === 'auto');
    // Left the search because it merged/closed, or because the user already reviewed it.
    if (wasAuto && isTracked(snap.repo) && (snap.state !== 'open' || iReviewed(snap, login))) attr(snap.nodeId).auto = true;
  }

  const prevAssignedKeys = new Set(
    db.select({ key: tickets.key }).from(tickets).where(and(eq(tickets.userId, user.id), eq(tickets.assignedToMe, true))).all().map((t) => t.key),
  );
  const ticketStatus = new Map<string, JiraIssue>(assignedByKey);
  if (assigned) await lookupLinkedTickets(user, [...snapshots.values()], ticketStatus);

  const attention: StreamMessage['attention'] = [];

  db.transaction((tx) => {
    for (const snap of snapshots.values()) {
      const a = attribution.get(snap.nodeId) ?? { auto: false, manual: false, jiraKeys: new Set<string>() };
      const sources: Source[] = [...(a.auto ? ['auto' as const] : []), ...(a.manual ? ['manual' as const] : []), ...(a.jiraKeys.size ? ['jira' as const] : [])];
      const row = rowByNode.get(snap.nodeId);
      const prevJiraKeys = new Set((row ? (prevSourcesByPr.get(row.id) ?? []) : []).filter((s) => s.source === 'jira').map((s) => s.jiraKey));

      if (sources.length === 0) {
        if (row && !row.dismissed) {
          if (prevJiraKeys.size && assigned) {
            tx.insert(events).values({ prId: row.id, type: 'ticket_unassigned', severity: 'info', text: `${[...prevJiraKeys].join(', ')} reassigned away from you` }).run();
          }
          tx.update(prs).set({ dismissed: true }).where(eq(prs.id, row.id)).run();
        }
        continue;
      }
      if (row?.dismissed && snap.state !== 'open') continue;

      const role = deriveRole(snap, login, sources, iReviewed(snap, login));
      const prevSnap = row ? (row.snapshot as PrSnapshot) : null;
      const diff: DiffEvent[] = diffSnapshots(prevSnap, snap, {
        myLogin: login,
        role,
        now,
        staleDays: user.staleDays,
        lastStaleAt: row?.lastStaleAt ? new Date(row.lastStaleAt) : null,
      });

      for (const key of a.jiraKeys) {
        if (prevJiraKeys.has(key)) continue;
        diff.push(
          prevAssignedKeys.has(key) || !assigned
            ? { type: 'pr_linked_to_ticket', severity: 'info', text: `Linked to your ticket ${key}` }
            : { type: 'ticket_assigned', severity: 'info', text: `${key} assigned to you` },
        );
      }

      const prId = row
        ? row.id
        : tx.insert(prs).values({ userId: user.id, nodeId: snap.nodeId, repo: snap.repo, number: snap.number, snapshot: snap, snapshotHash: '' }).returning({ id: prs.id }).get().id;

      if (snap.state === 'merged') {
        const linkedKey = extractJiraKeys(snap.headRef, snap.title).find((k) => ticketStatus.get(k)?.statusCategory !== 'done' && ticketStatus.has(k));
        const already = tx.select({ id: events.id }).from(events).where(and(eq(events.prId, prId), eq(events.type, 'ticket_out_of_sync'))).get();
        if (linkedKey && !already) {
          diff.push({ type: 'ticket_out_of_sync', severity: 'info', text: `Merged, but ${linkedKey} is still ${ticketStatus.get(linkedKey)!.status}` });
        }
      }

      for (const e of diff) tx.insert(events).values({ prId, type: e.type, severity: e.severity, text: e.text }).run();

      const hasAttention = diff.some((e) => e.severity === 'attention');
      tx.update(prs)
        .set({
          repo: snap.repo,
          number: snap.number,
          snapshot: snap,
          snapshotHash: sha256(JSON.stringify(snap)),
          updatedAt: now.toISOString(),
          ...(hasAttention ? { muted: false } : {}),
          ...(diff.some((e) => e.type === 'stale') ? { lastStaleAt: now.toISOString() } : {}),
          ...(snap.state === 'closed' ? { dismissed: true } : snap.state === 'open' ? { dismissed: false } : {}),
        })
        .where(eq(prs.id, prId))
        .run();

      tx.delete(prSources).where(and(eq(prSources.prId, prId), inArray(prSources.source, ['auto', 'jira']))).run();
      if (a.auto) tx.insert(prSources).values({ prId, source: 'auto' }).run();
      for (const key of a.jiraKeys) tx.insert(prSources).values({ prId, source: 'jira', jiraKey: key }).run();

      const newlyFailed = diff.filter((e) => e.type === 'check_failed').map((e) => e.text.replace(/^Check failed: /, ''));
      if (newlyFailed.length && snap.state === 'open') {
        const checks = snap.checks.filter((c) => newlyFailed.includes(c.name));
        queueMicrotask(() => analyzeFailures(user, prId, snap, checks, () => publish(user.id, { type: 'sync', attention: [] })));
      }

      if (hasAttention && user.initialSyncDone) {
        for (const e of diff.filter((d) => d.severity === 'attention')) {
          attention.push({ prId: String(prId), repo: snap.repo, number: snap.number, text: e.text });
        }
      }
    }

    if (assigned) {
      tx.delete(tickets).where(eq(tickets.userId, user.id)).run();
      for (const issue of ticketStatus.values()) {
        tx.insert(tickets)
          .values({
            userId: user.id,
            key: issue.key,
            title: issue.title,
            status: issue.status,
            statusCategory: issue.statusCategory,
            assignee: issue.assignee,
            assignedToMe: assignedByKey.has(issue.key),
            url: user.jiraSiteUrl ? `${user.jiraSiteUrl}/browse/${issue.key}` : null,
          })
          .run();
      }
    }

    // The first import shouldn't arrive as dozens of unread events.
    if (!user.initialSyncDone) {
      const latest = tx.select({ prId: events.prId, maxId: max(events.id) }).from(events).innerJoin(prs, eq(prs.id, events.prId)).where(eq(prs.userId, user.id)).groupBy(events.prId).all();
      for (const l of latest) tx.update(prs).set({ lastSeenEventId: l.maxId ?? 0 }).where(eq(prs.id, l.prId)).run();
    }

    tx.update(users)
      .set({ lastSyncAt: now.toISOString(), githubStatus: 'ok', rateLimitedUntil: null, initialSyncDone: true })
      .where(eq(users.id, user.id))
      .run();
  });

  publish(user.id, { type: 'sync', attention });
}

/** Status for tickets mentioned by tracked PRs that aren't assigned to the user. */
async function lookupLinkedTickets(user: User, snaps: PrSnapshot[], known: Map<string, JiraIssue>) {
  const projects = new Set(user.jiraProjects);
  const wanted = new Set<string>();
  for (const s of snaps) {
    for (const key of extractJiraKeys(s.headRef, s.title)) {
      if (known.has(key)) continue;
      if (projects.size && !projects.has(key.split('-')[0]!)) continue;
      wanted.add(key);
    }
  }
  for (const key of [...wanted].slice(0, 20)) {
    try {
      const issue = await getIssue(user, key);
      if (issue) known.set(key, issue);
    } catch (err) {
      if (err instanceof JiraAuthError) return;
    }
  }
}
