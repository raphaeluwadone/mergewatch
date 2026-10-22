export type Source = 'auto' | 'manual' | 'jira';
export type Role = 'author' | 'reviewer' | 'ticket_owner' | 'watching';

export type CheckStatus = 'passed' | 'failed' | 'running' | 'queued' | 'skipped';

export interface CheckRun {
  name: string;
  status: CheckStatus;
  durationSec: number | null;
  url: string | null;
  /** GitHub Actions job id, when the check is an Actions job. Used to fetch logs. */
  jobId: number | null;
}

export type MergeState = 'clean' | 'behind' | 'conflict' | 'unknown';
export type ReviewDecision = 'approved' | 'changes_requested' | 'review_required' | null;
export type PrState = 'open' | 'merged' | 'closed';

export interface Review {
  reviewer: string;
  state: 'approved' | 'changes_requested' | 'commented' | 'dismissed' | 'pending';
  submittedAt: string;
  body: string;
}

export interface Comment {
  author: string;
  createdAt: string;
  body: string;
  url?: string | null;
  /** File path, for inline code-review comments. */
  path?: string | null;
}

/** Normalized PR state as fetched from GitHub. Stored per poll; the differ compares two of these. */
export interface PrSnapshot {
  nodeId: string;
  repo: string;
  number: number;
  title: string;
  body: string;
  url: string;
  author: string;
  state: PrState;
  isDraft: boolean;
  headRef: string;
  baseRef: string;
  headSha: string;
  mergeState: MergeState;
  reviewDecision: ReviewDecision;
  reviews: Review[];
  reviewRequestedFromMe: boolean;
  commentCount: number;
  latestComments: Comment[];
  checks: CheckRun[];
  createdAt: string;
  updatedAt: string;
  mergedAt: string | null;
}

export type PrStatus =
  | 'failed'
  | 'changes'
  | 'conflict'
  | 'stale'
  | 'review'
  | 'running'
  | 'waiting'
  | 'manual'
  | 'approved'
  | 'merged';

export type Section = 'needs' | 'waiting' | 'green';
export type Severity = 'attention' | 'info' | 'noise';

export type EventType =
  | 'first_seen'
  | 'added_manually'
  | 'new_commit'
  | 'check_started'
  | 'check_failed'
  | 'check_recovered'
  | 'changes_requested'
  | 'review_approved'
  | 'review_requested'
  | 'new_comment'
  | 'merge_conflict'
  | 'conflict_resolved'
  | 'behind_base'
  | 'stale'
  | 'merged'
  | 'closed'
  | 'ticket_assigned'
  | 'pr_linked_to_ticket'
  | 'ticket_unassigned'
  | 'ticket_out_of_sync';

export interface PrEvent {
  id: number;
  type: EventType;
  severity: Severity;
  text: string;
  /** Short plain-text excerpt, e.g. the comment that triggered the event. */
  detail: string | null;
  createdAt: string;
}

export type AgentCategory = 'caused_by_diff' | 'flaky' | 'infra' | 'conflict' | 'reviewer_action';
export type Confidence = 'high' | 'medium' | 'low';

export interface AgentAnalysis {
  status: 'analyzing' | 'done' | 'unavailable' | 'failed';
  checkName: string;
  category: AgentCategory | null;
  confidence: Confidence | null;
  text: string | null;
  logExcerpt: string[];
  logUrl: string | null;
}

export interface JiraLink {
  key: string;
  title: string | null;
  status: string | null;
  assignee: string | null;
  assignedToMe: boolean;
  url: string | null;
}

export interface ChecksSummary {
  total: number;
  passed: number;
  failed: number;
  running: number;
}

export interface PrView {
  id: string;
  repo: string;
  number: number;
  title: string;
  url: string;
  author: string;
  branch: string;
  sources: Source[];
  role: Role;
  status: PrStatus;
  section: Section;
  mergeState: MergeState;
  checks: ChecksSummary;
  jira: JiraLink | null;
  unreadCount: number;
  lastActivityAt: string;
  agent: AgentAnalysis | null;
  review: { reviewer: string; excerpt: string; comments: number } | null;
  /** Most recent comment or review note from someone else. */
  latestComment: LatestComment | null;
  detail: string | null;
  muted: boolean;
}

export interface LatestComment {
  author: string;
  excerpt: string;
  createdAt: string;
  url: string | null;
  path: string | null;
  unread: boolean;
}

export interface TimelineEvent extends PrEvent {
  unread: boolean;
}

export interface PrDetail extends PrView {
  checkList: CheckRun[];
  timeline: TimelineEvent[];
  siblings: { id: string; repo: string; number: number; title: string }[];
}

export interface TicketPlaceholder {
  key: string;
  title: string;
  status: string;
  url: string | null;
}

export type GithubConnection = 'ok' | 'expired' | 'rate_limited';
export type JiraConnection = 'connected' | 'not_connected' | 'disconnected' | 'expired';

export interface ConnectionState {
  github: GithubConnection;
  jira: JiraConnection;
  lastSyncAt: string | null;
  rateLimitedUntil: string | null;
}

export interface Me {
  login: string;
  name: string | null;
  avatarUrl: string | null;
  onboarded: boolean;
}

export interface DashboardResponse {
  connection: ConnectionState;
  syncing: boolean;
  trackedRepoCount: number;
  prs: PrView[];
  tickets: TicketPlaceholder[];
}

export interface Settings {
  staleDays: number;
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
  jiraProjects: string[];
  autoAttributeJira: boolean;
  desktopNotifications: boolean;
  slackNotifications: boolean;
  /** 'default', 'system:<Name>' or 'custom'. */
  notificationSound: string;
  customSoundName: string | null;
}

export type AddPrPreview =
  | { result: 'valid'; repo: string; number: number; title: string; author: string; openedByMe: boolean }
  | { result: 'invalid' }
  | { result: 'no_access' }
  | { result: 'closed'; repo: string; number: number; title: string }
  | { result: 'tracked'; id: string; via: Source[] };

/** Pushed over the live stream when a sync changes something. */
export interface StreamMessage {
  type: 'sync';
  attention: { prId: string; repo: string; number: number; text: string }[];
}
