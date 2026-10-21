import { Hono } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { eq } from 'drizzle-orm';
import { db } from '../db/client.ts';
import { users } from '../db/schema.ts';
import { env } from '../env.ts';
import { exchangeToken, storeTokens } from '../jira/client.ts';
import { consumeState, createState } from './oauth-state.ts';
import { sessionUser } from './session.ts';
import { requestSync } from '../sync/poller.ts';

const SCOPES = 'read:jira-work read:jira-user offline_access';
const NEXT = { onboarding: '/onboarding/repos', settings: '/settings' } as const;
const callbackUrl = () => `${env.appUrl}/auth/jira/callback`;

export const jiraAuth = new Hono();

jiraAuth.get('/jira/connect', (c) => {
  const user = sessionUser(c);
  if (!user) return c.redirect(`${env.appUrl}/signin`);
  const next = c.req.query('next') === 'onboarding' ? 'onboarding' : 'settings';
  if (!env.jira.clientId) return c.redirect(`${env.appUrl}${NEXT[next]}?jira=not_configured`);
  setCookie(c, 'mw_jira_next', next, { httpOnly: true, sameSite: 'Lax', path: '/auth/jira', maxAge: 600, secure: env.isProduction });

  const url = new URL('https://auth.atlassian.com/authorize');
  url.searchParams.set('audience', 'api.atlassian.com');
  url.searchParams.set('client_id', env.jira.clientId);
  url.searchParams.set('scope', SCOPES);
  url.searchParams.set('redirect_uri', callbackUrl());
  url.searchParams.set('state', createState('jira', user.id));
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('prompt', 'consent');
  return c.redirect(url.toString());
});

jiraAuth.get('/jira/callback', async (c) => {
  const next = getCookie(c, 'mw_jira_next') === 'onboarding' ? 'onboarding' : 'settings';
  deleteCookie(c, 'mw_jira_next', { path: '/auth/jira' });
  const back = (result: string) => c.redirect(`${env.appUrl}${NEXT[next]}?jira=${result}`);

  const user = sessionUser(c);
  const state = consumeState('jira', c.req.query('state'));
  // The state must belong to the same signed-in user who started the flow.
  if (!user || !state || state.userId !== user.id) return back('failed');
  if (c.req.query('error')) return back('cancelled');
  const code = c.req.query('code');
  if (!code) return back('failed');

  try {
    const tokens = await exchangeToken({ grant_type: 'authorization_code', code, redirect_uri: callbackUrl() });
    const headers = { Authorization: `Bearer ${tokens.access_token}`, Accept: 'application/json' };
    const sites = (await (await fetch('https://api.atlassian.com/oauth/token/accessible-resources', { headers })).json()) as {
      id: string;
      url: string;
    }[];
    const site = sites[0];
    if (!site) return back('no_site');
    const me = (await (await fetch(`https://api.atlassian.com/ex/jira/${site.id}/rest/api/3/myself`, { headers })).json()) as {
      accountId: string;
    };
    storeTokens(user.id, tokens, { jiraCloudId: site.id, jiraSiteUrl: site.url, jiraAccountId: me.accountId });
    requestSync(user.id);
    return back('connected');
  } catch {
    return back('failed');
  }
});

export function disconnectJira(userId: number) {
  db.update(users)
    .set({
      jiraAccessEnc: null,
      jiraRefreshEnc: null,
      jiraExpiresAt: null,
      jiraCloudId: null,
      jiraSiteUrl: null,
      jiraAccountId: null,
      jiraStatus: 'not_connected',
    })
    .where(eq(users.id, userId))
    .run();
}
