import { describe, expect, it, vi, beforeAll } from 'vitest';
import type { PrSnapshot } from '@mergewatch/shared';

// Point the server at a throwaway database before any module reads its config.
vi.hoisted(() => {
  process.env.DATABASE_PATH = `data/test-poller-${process.pid}.db`;
  process.env.ENCRYPTION_KEY = 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=';
  process.env.DEMO_MODE = '1';
});

const github = vi.hoisted(() => ({
  searchMyPrs: vi.fn(async (): Promise<PrSnapshot[]> => []),
  listOpenPrHeads: vi.fn(async (): Promise<{ id: string; title: string; headRefName: string }[]> => []),
  fetchPrsByIds: vi.fn(async (): Promise<PrSnapshot[]> => []),
}));
vi.mock('../github/prs.ts', () => github);

const push = vi.hoisted(() => ({ notifyUser: vi.fn(async () => {}) }));
vi.mock('../push/send.ts', () => push);

const { db, runMigrations, env } = await import('./test-db.ts');
const { prSources, prs, trackedRepos, users } = await import('../db/schema.ts');
const { encrypt } = await import('../crypto.ts');
const { syncUser } = await import('./poller.ts');
const { listViews } = await import('../views.ts');
const { eq } = await import('drizzle-orm');

function teammatePr(over: Partial<PrSnapshot> = {}): PrSnapshot {
  return {
    nodeId: 'PR_TEAM',
    repo: 'acme/web',
    number: 42,
    title: 'Teammate change',
    body: '',
    url: 'https://github.com/acme/web/pull/42',
    author: 'dkim',
    state: 'open',
    isDraft: false,
    headRef: 'feat/x',
    baseRef: 'main',
    headSha: 'aaa',
    mergeState: 'clean',
    reviewDecision: 'review_required',
    reviews: [],
    reviewRequestedFromMe: false,
    commentCount: 0,
    latestComments: [],
    checks: [{ name: 'e2e', status: 'failed', durationSec: 10, url: null, jobId: null }],
    createdAt: '2026-10-22T10:00:00Z',
    updatedAt: '2026-10-22T10:00:00Z',
    mergedAt: null,
    ...over,
  };
}

let userId = 0;
const user = () => db.select().from(users).where(eq(users.id, userId)).get()!;
const sourcesOf = () =>
  db
    .select({ source: prSources.source })
    .from(prSources)
    .innerJoin(prs, eq(prs.id, prSources.prId))
    .where(eq(prs.userId, userId))
    .all()
    .map((s) => s.source);

beforeAll(() => {
  expect(env.databasePath).toContain('test-poller-');
  runMigrations();
  userId = db.insert(users).values({ githubId: 1, login: 'me', githubTokenEnc: encrypt('token'), initialSyncDone: true }).returning({ id: users.id }).get().id;
  db.insert(trackedRepos).values({ userId, fullName: 'acme/web', watchAll: true }).run();
});

describe('watching every PR in a repo', () => {
  it('pulls in teammates’ PRs as context, not as work', async () => {
    github.listOpenPrHeads.mockResolvedValue([{ id: 'PR_TEAM', title: 'Teammate change', headRefName: 'feat/x' }]);
    github.fetchPrsByIds.mockResolvedValue([teammatePr()]);
    await syncUser(userId);

    expect(sourcesOf()).toEqual(['repo']);
    const [view] = listViews(user()).prs;
    expect(view).toMatchObject({ role: 'observer', status: 'manual', section: 'waiting', unreadCount: 0 });
    expect(view!.detail).toBe("Opened by dkim. You're watching this repo.");
  });

  it('notifies for a new comment but not for its failing check', async () => {
    push.notifyUser.mockClear();
    github.fetchPrsByIds.mockResolvedValue([
      teammatePr({
        headSha: 'bbb',
        updatedAt: '2026-10-22T11:00:00Z',
        latestComments: [{ author: 'jalvarez', createdAt: '2026-10-22T10:30:00Z', body: 'Looks close', url: null, path: null }],
      }),
    ]);
    await syncUser(userId);

    const items = (push.notifyUser.mock.calls.at(-1) as unknown as [unknown, { type: string }[]])[1];
    expect(items.map((i) => i.type)).toEqual(['new_comment']);
  });

  it('drops the PR when the repo watch is switched off', async () => {
    db.update(trackedRepos).set({ watchAll: false }).where(eq(trackedRepos.userId, userId)).run();
    github.listOpenPrHeads.mockClear();
    await syncUser(userId);

    expect(github.listOpenPrHeads).not.toHaveBeenCalled();
    expect(listViews(user()).prs).toEqual([]);
  });
});
