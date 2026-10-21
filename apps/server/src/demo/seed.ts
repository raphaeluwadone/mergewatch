import { eq } from 'drizzle-orm';
import { env } from '../env.ts';
import { db, runMigrations } from '../db/client.ts';
import { analyses, events, prSources, prs, tickets, trackedRepos, users } from '../db/schema.ts';
import { DEMO_LOGIN, DEMO_REPOS, DEMO_TICKETS, demoFixtures } from './fixtures.ts';

if (!env.demoMode) {
  console.error('Refusing to seed: set DEMO_MODE=1 in .env first.');
  process.exit(1);
}

runMigrations();

const ago = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

db.transaction((tx) => {
  tx.delete(users).where(eq(users.login, DEMO_LOGIN)).run();
  const user = tx
    .insert(users)
    .values({
      githubId: -1,
      login: DEMO_LOGIN,
      name: 'Demo Developer',
      jiraStatus: 'connected',
      jiraSiteUrl: 'https://example.atlassian.net',
      onboarded: true,
      initialSyncDone: true,
      lastSyncAt: new Date().toISOString(),
    })
    .returning({ id: users.id })
    .get();

  for (const fullName of DEMO_REPOS) tx.insert(trackedRepos).values({ userId: user.id, fullName }).run();
  for (const t of DEMO_TICKETS) {
    tx.insert(tickets).values({ userId: user.id, ...t, assignee: 'Demo Developer', url: `https://example.atlassian.net/browse/${t.key}` }).run();
  }

  for (const f of demoFixtures()) {
    const prId = tx
      .insert(prs)
      .values({ userId: user.id, nodeId: f.snap.nodeId, repo: f.snap.repo, number: f.snap.number, snapshot: f.snap, snapshotHash: 'demo' })
      .returning({ id: prs.id })
      .get().id;
    for (const source of f.sources) {
      tx.insert(prSources).values({ prId, source, jiraKey: source === 'jira' ? (f.jiraKey ?? '') : '' }).run();
    }
    let lastSeen = 0;
    for (const e of [...f.events].sort((a, b) => b.hoursAgo - a.hoursAgo)) {
      const id = tx.insert(events).values({ prId, type: e.type, severity: e.severity, text: e.text, createdAt: ago(e.hoursAgo) }).returning({ id: events.id }).get().id;
      if (!e.unread) lastSeen = id;
    }
    tx.update(prs).set({ lastSeenEventId: lastSeen }).where(eq(prs.id, prId)).run();
    const failed = f.snap.checks.find((c) => c.status === 'failed');
    if (f.analysis && failed) {
      tx.insert(analyses)
        .values({
          prId,
          headSha: f.snap.headSha,
          checkName: failed.name,
          status: f.analysis.status,
          category: f.analysis.category ?? null,
          confidence: f.analysis.confidence ?? null,
          text: f.analysis.text ?? null,
          logExcerpt: f.analysis.log ?? [],
          logUrl: failed.url,
        })
        .run();
    }
  }
});

console.log(`Seeded demo user "${DEMO_LOGIN}" with ${demoFixtures().length} PRs.`);
