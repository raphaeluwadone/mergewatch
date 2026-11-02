import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.DATABASE_PATH = `data/test-jira-${process.pid}.db`;
  process.env.ENCRYPTION_KEY = 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=';
  process.env.DEMO_MODE = '1';
});

const { db, runMigrations } = await import('../sync/test-db.ts');
const { users } = await import('../db/schema.ts');
const { encrypt, decrypt } = await import('../crypto.ts');
const { getIssue } = await import('./client.ts');
const { eq } = await import('drizzle-orm');

let githubId = 100;
function connectedUser() {
  const id = db
    .insert(users)
    .values({
      githubId: githubId++,
      login: 'me',
      jiraAccessEnc: encrypt('old-access'),
      jiraRefreshEnc: encrypt('refresh-1'),
      jiraExpiresAt: new Date(Date.now() - 1000).toISOString(),
      jiraCloudId: 'cloud',
      jiraStatus: 'connected',
    })
    .returning({ id: users.id })
    .get().id;
  return db.select().from(users).where(eq(users.id, id)).get()!;
}
const reload = (id: number) => db.select().from(users).where(eq(users.id, id)).get()!;

const issue = { key: 'ABC-1', fields: { summary: 'Fix', status: { name: 'To Do', statusCategory: { key: 'new' } }, assignee: null } };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeAll(() => runMigrations());
afterEach(() => vi.unstubAllGlobals());

describe('Jira token refresh', () => {
  it('keeps Jira connected when the token endpoint has a transient failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('busy', { status: 503 })));
    const user = connectedUser();

    await expect(getIssue(user, 'ABC-1')).rejects.toThrow('503');
    expect(reload(user.id).jiraStatus).toBe('connected');
  });

  it('marks Jira expired when the refresh token is refused', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ error: 'invalid_grant' }, 400)));
    const user = connectedUser();

    await expect(getIssue(user, 'ABC-1')).rejects.toThrow();
    expect(reload(user.id).jiraStatus).toBe('expired');
  });

  it('refreshes once per sync and uses the rotated refresh token afterwards', async () => {
    const refreshTokensSent: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes('oauth/token')) {
          refreshTokensSent.push(JSON.parse(String(init?.body)).refresh_token);
          return json({ access_token: 'new-access', refresh_token: 'refresh-2', expires_in: 3600 });
        }
        return json(issue);
      }),
    );
    const user = connectedUser();

    await getIssue(user, 'ABC-1');
    await getIssue(user, 'ABC-1');

    expect(refreshTokensSent).toEqual(['refresh-1']);
    expect(decrypt(reload(user.id).jiraRefreshEnc!)).toBe('refresh-2');
  });
});
