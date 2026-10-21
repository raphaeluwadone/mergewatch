import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { db } from '../db/client.ts';
import { users } from '../db/schema.ts';
import { encrypt } from '../crypto.ts';
import { env } from '../env.ts';
import { GithubForbiddenError, GithubNotFoundError, rest } from '../github/client.ts';
import { getViewer } from '../github/prs.ts';
import { consumeState, createState } from './oauth-state.ts';
import { endSession, startSession } from './session.ts';
import { requestSync } from '../sync/poller.ts';

// OAuth Apps have no read-only repo scope; Mergewatch only ever makes read calls with this token.
const scopes = () => (env.github.allowedOrg ? 'repo read:org' : 'repo');
const callbackUrl = () => `${env.appUrl}/auth/github/callback`;
const signinError = (code: string) => `${env.appUrl}/signin?error=${code}`;

type Membership = 'member' | 'not_member' | 'org_restricted';

async function orgMembership(token: string): Promise<Membership> {
  if (!env.github.allowedOrg) return 'member';
  try {
    const m = await rest<{ state: string }>(token, `/user/memberships/orgs/${env.github.allowedOrg}`);
    return m.state === 'active' ? 'member' : 'not_member';
  } catch (err) {
    if (err instanceof GithubNotFoundError) return 'not_member';
    // The org blocks OAuth apps it hasn't approved.
    if (err instanceof GithubForbiddenError) return 'org_restricted';
    throw err;
  }
}

export const githubAuth = new Hono();

githubAuth.get('/github/login', (c) => {
  if (!env.github.clientId) return c.redirect(signinError('not_configured'));
  const url = new URL('https://github.com/login/oauth/authorize');
  url.searchParams.set('client_id', env.github.clientId);
  url.searchParams.set('redirect_uri', callbackUrl());
  url.searchParams.set('scope', scopes());
  url.searchParams.set('state', createState('github'));
  url.searchParams.set('allow_signup', 'false');
  return c.redirect(url.toString());
});

githubAuth.get('/github/callback', async (c) => {
  if (c.req.query('error')) return c.redirect(signinError('cancelled'));
  if (!consumeState('github', c.req.query('state'))) return c.redirect(signinError('expired'));
  const code = c.req.query('code');
  if (!code || !env.github.clientId || !env.github.clientSecret) return c.redirect(signinError('failed'));

  const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: env.github.clientId, client_secret: env.github.clientSecret, code, redirect_uri: callbackUrl() }),
  });
  const tokenBody = (await tokenRes.json()) as { access_token?: string };
  const token = tokenBody.access_token;
  if (!token) return c.redirect(signinError('failed'));

  const membership = await orgMembership(token);
  if (membership !== 'member') return c.redirect(signinError(membership));

  const viewer = await getViewer(token);
  const values = {
    githubId: viewer.id,
    login: viewer.login,
    name: viewer.name,
    avatarUrl: viewer.avatar_url,
    githubTokenEnc: encrypt(token),
    githubStatus: 'ok' as const,
    rateLimitedUntil: null,
  };
  const existing = db.select({ id: users.id }).from(users).where(eq(users.githubId, viewer.id)).get();
  const userId = existing
    ? (db.update(users).set(values).where(eq(users.id, existing.id)).run(), existing.id)
    : db.insert(users).values(values).returning({ id: users.id }).get().id;

  startSession(c, userId);
  requestSync(userId);
  return c.redirect(`${env.appUrl}/`);
});

githubAuth.post('/logout', (c) => {
  endSession(c);
  return c.json({ ok: true });
});
