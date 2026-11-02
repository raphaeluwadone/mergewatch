import { eq } from 'drizzle-orm';
import { db } from '../db/client.ts';
import { users } from '../db/schema.ts';
import { decrypt, encrypt } from '../crypto.ts';
import { env } from '../env.ts';
import type { User } from '../auth/session.ts';

export class JiraAuthError extends Error {}

export interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

export async function exchangeToken(body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch('https://auth.atlassian.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: env.jira.clientId, client_secret: env.jira.clientSecret, ...body }),
  });
  // 400/401 mean the grant itself was refused (invalid_grant); anything else is worth retrying later.
  if (res.status === 400 || res.status === 401) throw new JiraAuthError(`Atlassian token endpoint returned ${res.status}`);
  if (!res.ok) throw new Error(`Atlassian token endpoint returned ${res.status}`);
  return (await res.json()) as TokenResponse;
}

export function storeTokens(userId: number, tokens: TokenResponse, extra: Partial<typeof users.$inferInsert> = {}) {
  const values = {
    jiraAccessEnc: encrypt(tokens.access_token),
    // Atlassian rotates refresh tokens; keep the old one if a response omits it.
    ...(tokens.refresh_token ? { jiraRefreshEnc: encrypt(tokens.refresh_token) } : {}),
    jiraExpiresAt: new Date(Date.now() + (tokens.expires_in - 60) * 1000).toISOString(),
    jiraStatus: 'connected' as const,
    ...extra,
  };
  db.update(users).set(values).where(eq(users.id, userId)).run();
  return values;
}

function markExpired(userId: number) {
  db.update(users).set({ jiraStatus: 'expired', jiraAccessEnc: null }).where(eq(users.id, userId)).run();
}

async function accessToken(user: User, forceRefresh = false): Promise<string> {
  if (!user.jiraRefreshEnc || !user.jiraCloudId) throw new JiraAuthError('Jira not connected');
  const fresh = user.jiraAccessEnc && user.jiraExpiresAt && new Date(user.jiraExpiresAt) > new Date();
  if (fresh && !forceRefresh) return decrypt(user.jiraAccessEnc!);
  let refreshToken: string;
  try {
    refreshToken = decrypt(user.jiraRefreshEnc);
  } catch {
    markExpired(user.id);
    throw new JiraAuthError('Stored Jira refresh token is unreadable');
  }
  try {
    const tokens = await exchangeToken({ grant_type: 'refresh_token', refresh_token: refreshToken });
    // A sync reuses one user object; without this, later calls would refresh again with the rotated-out token.
    Object.assign(user, storeTokens(user.id, tokens));
    return tokens.access_token;
  } catch (err) {
    if (err instanceof JiraAuthError) markExpired(user.id);
    throw err;
  }
}

async function jiraFetch(user: User, path: string, init: RequestInit = {}, retried = false): Promise<Response> {
  const token = await accessToken(user, retried);
  const res = await fetch(`https://api.atlassian.com/ex/jira/${user.jiraCloudId}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'Content-Type': 'application/json', ...init.headers },
  });
  if (res.status === 401 && !retried) return jiraFetch(user, path, init, true);
  if (res.status === 401) {
    markExpired(user.id);
    throw new JiraAuthError('Jira token rejected');
  }
  return res;
}

export interface JiraIssue {
  key: string;
  title: string;
  status: string;
  statusCategory: string;
  assignee: string | null;
  assigneeAccountId: string | null;
}

interface RawIssue {
  key: string;
  fields: {
    summary: string;
    status: { name: string; statusCategory: { key: string } };
    assignee: { displayName: string; accountId: string } | null;
  };
}

const toIssue = (r: RawIssue): JiraIssue => ({
  key: r.key,
  title: r.fields.summary,
  status: r.fields.status.name,
  statusCategory: r.fields.status.statusCategory.key,
  assignee: r.fields.assignee?.displayName ?? null,
  assigneeAccountId: r.fields.assignee?.accountId ?? null,
});

const PROJECT_KEY = /^[A-Z][A-Z0-9]{1,9}$/;

/** Open tickets assigned to the user, optionally limited to some projects. */
export async function assignedIssues(user: User): Promise<JiraIssue[]> {
  const projects = user.jiraProjects.filter((p) => PROJECT_KEY.test(p));
  const projectClause = projects.length ? ` AND project in (${projects.join(',')})` : '';
  const res = await jiraFetch(user, '/rest/api/3/search/jql', {
    method: 'POST',
    body: JSON.stringify({
      jql: `assignee = currentUser() AND statusCategory != Done${projectClause} ORDER BY updated DESC`,
      fields: ['summary', 'status', 'assignee'],
      maxResults: 100,
    }),
  });
  if (!res.ok) throw new Error(`Jira search returned ${res.status}`);
  const body = (await res.json()) as { issues: RawIssue[] };
  return body.issues.map(toIssue);
}

/** One ticket by key, or null when it doesn't exist or isn't visible. */
export async function getIssue(user: User, key: string): Promise<JiraIssue | null> {
  if (!/^[A-Z][A-Z0-9]{1,9}-\d{1,7}$/.test(key)) return null;
  const res = await jiraFetch(user, `/rest/api/3/issue/${key}?fields=summary,status,assignee`);
  if (res.status === 404 || res.status === 400) return null;
  if (!res.ok) throw new Error(`Jira issue lookup returned ${res.status}`);
  return toIssue((await res.json()) as RawIssue);
}
