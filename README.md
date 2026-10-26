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

Mergewatch sees whatever your GitHub account can see, using the `repo` scope. It reads PRs, and only writes to GitHub when you ask it to: merging a PR, turning auto-merge on or off, or deleting a merged branch. To limit sign-in to one organization, set `GITHUB_ALLOWED_ORG`.

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

## Merging

Open a PR and use **Merge…** in its panel. Merging is only offered when the PR is fully ready: every check passed, review requirements met, no conflicts, and GitHub reports it mergeable. Mergewatch never uses an admin override of branch protection.

The merge is pinned to the commit you were looking at, so if someone pushes in between, GitHub rejects it. You can pick squash, merge commit or rebase (whatever the repo allows), and delete the branch afterwards. Repos with a merge queue get **Add to queue** instead.

For PRs that aren't ready yet, **Turn on auto-merge** hands off to GitHub's own auto-merge, which merges once every check and review passes. The repo needs "Allow auto-merge" enabled in its GitHub settings.

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
