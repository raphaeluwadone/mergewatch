import { Hono } from 'hono';
import { secureHeaders } from 'hono/secure-headers';
import { HTTPException } from 'hono/http-exception';
import { env } from './env.ts';
import { githubAuth } from './auth/github.ts';
import { jiraAuth } from './auth/jira.ts';
import { requireAppHeader } from './auth/session.ts';
import { api } from './routes/api.ts';
import { rattleInbound } from './rattle/inbound.ts';
import { demoAuth } from './demo/auth.ts';

export const app = new Hono();

app.use('*', secureHeaders());
app.use('/api/*', requireAppHeader);
app.use('/auth/*', requireAppHeader);

app.route('/auth', githubAuth);
app.route('/auth', jiraAuth);
if (env.demoMode) app.route('/auth', demoAuth);
// Before /api, whose routes all need a session cookie.
app.route('/api/inbound/rattle', rattleInbound);
app.route('/api', api);

app.get('/health', (c) => c.json({ ok: true }));
app.get('/auth/config', (c) =>
  c.json({ demo: env.demoMode, githubConfigured: !!env.github.clientId, jiraConfigured: !!env.jira.clientId, org: env.github.allowedOrg }),
);

app.onError((err, c) => {
  if (err instanceof HTTPException) return err.getResponse();
  // Never echo internals (tokens, upstream bodies) back to the browser.
  console.error(err);
  return c.json({ error: 'internal_error' }, 500);
});
