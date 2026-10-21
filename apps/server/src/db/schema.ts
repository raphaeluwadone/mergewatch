import { sql } from 'drizzle-orm';
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  githubId: integer('github_id').notNull().unique(),
  login: text('login').notNull(),
  name: text('name'),
  avatarUrl: text('avatar_url'),
  /** AES-256-GCM, see crypto.ts. */
  githubTokenEnc: text('github_token_enc'),
  githubStatus: text('github_status', { enum: ['ok', 'expired', 'rate_limited'] }).notNull().default('ok'),
  rateLimitedUntil: text('rate_limited_until'),
  jiraAccessEnc: text('jira_access_enc'),
  jiraRefreshEnc: text('jira_refresh_enc'),
  jiraExpiresAt: text('jira_expires_at'),
  jiraCloudId: text('jira_cloud_id'),
  jiraSiteUrl: text('jira_site_url'),
  jiraAccountId: text('jira_account_id'),
  jiraStatus: text('jira_status', { enum: ['connected', 'not_connected', 'disconnected', 'expired'] }).notNull().default('not_connected'),
  onboarded: integer('onboarded', { mode: 'boolean' }).notNull().default(false),
  initialSyncDone: integer('initial_sync_done', { mode: 'boolean' }).notNull().default(false),
  lastSyncAt: text('last_sync_at'),
  staleDays: integer('stale_days').notNull().default(3),
  quietHoursStart: text('quiet_hours_start'),
  quietHoursEnd: text('quiet_hours_end'),
  jiraProjects: text('jira_projects', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
  autoAttributeJira: integer('auto_attribute_jira', { mode: 'boolean' }).notNull().default(true),
  desktopNotifications: integer('desktop_notifications', { mode: 'boolean' }).notNull().default(true),
  slackNotifications: integer('slack_notifications', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull().default(now),
});

export const sessions = sqliteTable('sessions', {
  /** SHA-256 of the cookie value; the raw id never touches the database. */
  idHash: text('id_hash').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: text('expires_at').notNull(),
});

export const trackedRepos = sqliteTable(
  'tracked_repos',
  {
    userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    fullName: text('full_name').notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.fullName] })],
);

export const prs = sqliteTable(
  'prs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    nodeId: text('node_id').notNull(),
    repo: text('repo').notNull(),
    number: integer('number').notNull(),
    snapshot: text('snapshot', { mode: 'json' }).notNull(),
    snapshotHash: text('snapshot_hash').notNull(),
    /** Ids of events at or below this value have been seen. */
    lastSeenEventId: integer('last_seen_event_id').notNull().default(0),
    /** Muted until the next attention event. */
    muted: integer('muted', { mode: 'boolean' }).notNull().default(false),
    dismissed: integer('dismissed', { mode: 'boolean' }).notNull().default(false),
    lastStaleAt: text('last_stale_at'),
    updatedAt: text('updated_at').notNull().default(now),
  },
  (t) => [uniqueIndex('prs_user_node').on(t.userId, t.nodeId), index('prs_user').on(t.userId)],
);

export const prSources = sqliteTable(
  'pr_sources',
  {
    prId: integer('pr_id').notNull().references(() => prs.id, { onDelete: 'cascade' }),
    source: text('source', { enum: ['auto', 'manual', 'jira'] }).notNull(),
    /** For `jira`: the ticket that attributed this PR. Empty string otherwise, to keep the key simple. */
    jiraKey: text('jira_key').notNull().default(''),
  },
  (t) => [primaryKey({ columns: [t.prId, t.source, t.jiraKey] })],
);

export const events = sqliteTable(
  'events',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    prId: integer('pr_id').notNull().references(() => prs.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    severity: text('severity', { enum: ['attention', 'info', 'noise'] }).notNull(),
    text: text('text').notNull(),
    createdAt: text('created_at').notNull().default(now),
  },
  (t) => [index('events_pr').on(t.prId, t.id)],
);

export const tickets = sqliteTable(
  'tickets',
  {
    userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    title: text('title').notNull(),
    status: text('status').notNull(),
    statusCategory: text('status_category').notNull(),
    assignee: text('assignee'),
    assignedToMe: integer('assigned_to_me', { mode: 'boolean' }).notNull(),
    url: text('url'),
    updatedAt: text('updated_at').notNull().default(now),
  },
  (t) => [primaryKey({ columns: [t.userId, t.key] })],
);

export const analyses = sqliteTable(
  'analyses',
  {
    prId: integer('pr_id').notNull().references(() => prs.id, { onDelete: 'cascade' }),
    headSha: text('head_sha').notNull(),
    checkName: text('check_name').notNull(),
    status: text('status', { enum: ['analyzing', 'done', 'unavailable', 'failed'] }).notNull(),
    category: text('category'),
    confidence: text('confidence'),
    text: text('text'),
    logExcerpt: text('log_excerpt', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    logUrl: text('log_url'),
    createdAt: text('created_at').notNull().default(now),
  },
  (t) => [primaryKey({ columns: [t.prId, t.headSha, t.checkName] })],
);

/** Short-lived OAuth `state` values, to stop login CSRF. */
export const oauthStates = sqliteTable('oauth_states', {
  state: text('state').primaryKey(),
  provider: text('provider', { enum: ['github', 'jira'] }).notNull(),
  userId: integer('user_id'),
  expiresAt: text('expires_at').notNull(),
});
