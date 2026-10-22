# Mergewatch

One dashboard for every pull request that needs you. Mergewatch follows the PRs you author or review, PRs you add by link, and PRs linked to Jira tickets assigned to you, and shows only what changed since you last looked.

## Run it

Needs Node 24 (pnpm downloads it for this project) and pnpm 10.

```bash
pnpm install
cp .env.example .env   # then fill it in, see below
pnpm dev               # web on http://localhost:5180, API on 127.0.0.1:8787
```

### Try it without GitHub

Set `DEMO_MODE=1` and an `ENCRYPTION_KEY` in `.env`, then:

```bash
pnpm seed:demo
pnpm dev
```

Open http://localhost:5180 and choose **Use the demo account**. Demo mode is refused when `NODE_ENV=production`.

## Connect GitHub

1. github.com/settings/developers > **New OAuth App**.
2. Homepage URL `http://localhost:5180`, callback URL `http://localhost:5180/auth/github/callback`.
3. Put the client ID and a new client secret in `.env` as `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`.

Mergewatch sees whatever your GitHub account can see. OAuth Apps can't be scoped to read-only, so it asks for `repo`, but it only makes read calls. To limit sign-in to one organization, set `GITHUB_ALLOWED_ORG`.

If an organization restricts third-party OAuth apps, its private repos stay hidden until an org owner approves Mergewatch.

## Connect Jira (optional)

1. developer.atlassian.com/console/myapps > **Create** > OAuth 2.0 integration.
2. Permissions: Jira API with `read:jira-work` and `read:jira-user`.
3. Authorization callback URL `http://localhost:5180/auth/jira/callback`.
4. Put the client ID and secret in `.env` as `JIRA_CLIENT_ID` and `JIRA_CLIENT_SECRET`, then connect from onboarding or Settings.

## Notifications

Push notifications reach you even when no Mergewatch tab is open, as long as the browser is running. Turn them on in **Settings > Notifications > Enable on this browser**.

You get one per PR per sync, for anything that needs you, comments from others, approvals, merges and Jira assignments. Quiet hours and muted PRs are respected.

Browsers can't play custom notification sounds, so on a Mac the server plays your chosen sound (a macOS sound or an uploaded file) with `afplay` and the notification itself stays silent.

## The agent

The agent explains failed checks. It is off until `AGENT_PROVIDER=anthropic` and `ANTHROPIC_API_KEY` are set. Logs are redacted (`apps/server/src/agent/redact.ts`) before anything is sent. Confirm the provider is approved for your organization's data before turning it on.

## Layout

| Path | What |
| --- | --- |
| `packages/shared` | Types and parsing shared by server and web |
| `apps/server` | Hono API, SQLite via Drizzle, GitHub and Jira clients, poller, agent |
| `apps/web` | React + Vite dashboard |

```bash
pnpm test        # Vitest
pnpm typecheck
pnpm db:generate # after changing apps/server/src/db/schema.ts
```
