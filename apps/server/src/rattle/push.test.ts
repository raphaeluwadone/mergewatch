import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PrSnapshot, PrView } from '@mergewatch/shared';

vi.hoisted(() => {
  process.env.DATABASE_PATH = `data/test-rattle-${process.pid}.db`;
  process.env.ENCRYPTION_KEY = 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=';
  process.env.DEMO_MODE = '1';
});

const { db, runMigrations } = await import('../sync/test-db.ts');
const { events, prSources, prs, users } = await import('../db/schema.ts');
const { encrypt, sha256 } = await import('../crypto.ts');
const { app } = await import('../app.ts');
const { pushToRattle, rattlePayload } = await import('./push.ts');
const { eq } = await import('drizzle-orm');

const view = (id: string, extra: Partial<PrView> = {}): PrView =>
  ({
    id,
    repo: 'acme/web',
    number: Number(id),
    title: `PR ${id}`,
    url: `https://github.com/acme/web/pull/${id}`,
    section: 'needs',
    status: 'failed',
    role: 'author',
    detail: 'e2e failing',
    unreadCount: 0,
    lastActivityAt: '2026-11-01T09:00:00.000Z',
    muted: false,
    ...extra,
  }) as PrView;

describe('rattlePayload', () => {
  it('sends PRs that need you or are waiting, skipping green and muted ones', () => {
    const payload = rattlePayload(
      [view('1'), view('2', { section: 'waiting', status: 'waiting' }), view('3', { section: 'green', status: 'approved' }), view('4', { muted: true })],
      new Map([['1', 9]]),
    );
    expect(payload.map((p) => [p.id, p.latestEventId])).toEqual([
      ['1', 9],
      ['2', 0],
    ]);
  });

  it('keeps PRs that need you when capping at 100', () => {
    const waiting = Array.from({ length: 120 }, (_, i) => view(String(i + 10), { section: 'waiting', status: 'waiting', lastActivityAt: '2026-11-02T00:00:00.000Z' }));
    const payload = rattlePayload([...waiting, view('1')], new Map());
    expect(payload).toHaveLength(100);
    expect(payload[0]!.id).toBe('1');
  });
});

describe('pushToRattle', () => {
  let userId = 0;
  let prId = 0;
  const user = () => db.select().from(users).where(eq(users.id, userId)).get()!;

  beforeAll(() => {
    runMigrations();
    userId = db
      .insert(users)
      .values({ githubId: 1, login: 'me', rattleUrl: 'http://localhost:5173', rattleTokenEnc: encrypt('rattle_mw_token'), rattleStatus: 'connected' })
      .returning({ id: users.id })
      .get().id;
    const snap = {
      nodeId: 'PR_A', repo: 'acme/web', number: 7, title: 'Fix login', body: '', url: 'https://github.com/acme/web/pull/7', author: 'me',
      state: 'open', isDraft: false, headRef: 'fix', baseRef: 'main', headSha: 'a', mergeState: 'clean', reviewDecision: null, reviews: [],
      reviewRequestedFromMe: false, commentCount: 0, latestComments: [], checks: [{ name: 'e2e', status: 'failed', durationSec: 1, url: null, jobId: null }],
      createdAt: '2026-11-01T09:00:00Z', updatedAt: '2026-11-01T09:00:00Z', mergedAt: null,
    } satisfies PrSnapshot;
    prId = db.insert(prs).values({ userId, nodeId: 'PR_A', repo: 'acme/web', number: 7, snapshot: snap, snapshotHash: '' }).returning({ id: prs.id }).get().id;
    db.insert(prSources).values({ prId, source: 'auto' }).run();
    db.insert(events).values({ prId, type: 'check_failed', severity: 'attention', text: 'Check failed: e2e' }).run();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('PUTs the set with the bearer token and records the push', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    await pushToRattle(user());

    const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(String(url)).toBe('http://localhost:5173/api/inbound/mergewatch/prs');
    expect(init.method).toBe('PUT');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer rattle_mw_token');
    const sent = JSON.parse(String(init.body)).prs;
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ repo: 'acme/web', number: 7, status: 'failed', section: 'needs', role: 'author' });
    expect(sent[0].latestEventId).toBeGreaterThan(0);
    expect(user().rattleStatus).toBe('connected');
    expect(user().rattleLastPushAt).not.toBeNull();
  });

  it('marks the connection unauthorized when Rattle rejects the token, and error when unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 401 })));
    await pushToRattle(user());
    expect(user().rattleStatus).toBe('unauthorized');

    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed'); }));
    await pushToRattle(user());
    expect(user().rattleStatus).toBe('error');
  });
});

describe('marking seen from Rattle', () => {
  let userId = 0;
  let prId = 0;
  const seen = (token: string, id: number, eventId: number) =>
    app.request(`/api/inbound/rattle/prs/${id}/seen`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'x-mergewatch': '1', 'content-type': 'application/json' },
      body: JSON.stringify({ eventId }),
    });
  const lastSeen = () => db.select().from(prs).where(eq(prs.id, prId)).get()!.lastSeenEventId;

  beforeAll(() => {
    userId = db.insert(users).values({ githubId: 2, login: 'me2', rattleCallbackHash: sha256('mw_rattle_good') }).returning({ id: users.id }).get().id;
    prId = db.insert(prs).values({ userId, nodeId: 'PR_B', repo: 'acme/web', number: 8, snapshot: {}, snapshotHash: '' }).returning({ id: prs.id }).get().id;
  });

  it('moves the seen marker to the event Rattle showed, never backwards', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 204 })));
    expect((await seen('mw_rattle_good', prId, 12)).status).toBe(200);
    expect(lastSeen()).toBe(12);
    await seen('mw_rattle_good', prId, 5);
    expect(lastSeen()).toBe(12);
  });

  it('rejects unknown tokens and PRs that belong to someone else', async () => {
    expect((await seen('mw_rattle_bad', prId, 20)).status).toBe(401);
    const other = db.insert(users).values({ githubId: 3, login: 'other', rattleCallbackHash: sha256('mw_rattle_other') }).returning({ id: users.id }).get().id;
    expect(other).toBeGreaterThan(0);
    expect((await seen('mw_rattle_other', prId, 20)).status).toBe(404);
    expect(lastSeen()).toBe(12);
  });
});
