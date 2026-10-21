import type { CheckRun, PrSnapshot } from '@mergewatch/shared';

export const DEMO_LOGIN = 'demo-dev';
export const DEMO_REPOS = ['EnfluxInc/eai-api', 'EnfluxInc/platform-ui', 'EnfluxInc/master-migrator', 'EnfluxInc/eai-ui'];

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

function checks(passed: number, failed: number, running: number, names: string[]): CheckRun[] {
  return names.map((name, i) => {
    const status = i < failed ? 'failed' : i < failed + running ? 'running' : i < failed + running + passed ? 'passed' : 'queued';
    return { name, status, durationSec: status === 'running' || status === 'queued' ? null : 40 + i * 35, url: `https://github.com/actions/${i}`, jobId: 1000 + i };
  });
}

const NAMES = ['lint', 'typecheck', 'unit tests', 'build', 'e2e', 'migrations', 'integration', 'coverage', 'deploy-preview'];

interface Fixture {
  snap: PrSnapshot;
  sources: ('auto' | 'manual' | 'jira')[];
  jiraKey?: string;
  events: { type: string; severity: 'attention' | 'info' | 'noise'; text: string; hoursAgo: number; unread: boolean }[];
  analysis?: { status: 'done' | 'analyzing'; category?: string; confidence?: string; text?: string; log?: string[] };
}

function pr(n: number, repo: string, title: string, over: Partial<PrSnapshot>): PrSnapshot {
  return {
    nodeId: `DEMO_EnfluxInc_${repo}_${n}`,
    repo: `EnfluxInc/${repo}`,
    number: n,
    title,
    body: '',
    url: `https://github.com/EnfluxInc/${repo}/pull/${n}`,
    author: DEMO_LOGIN,
    state: 'open',
    isDraft: false,
    headRef: 'feat/x',
    baseRef: 'develop',
    headSha: `sha${n}`,
    mergeState: 'clean',
    reviewDecision: 'review_required',
    reviews: [],
    reviewRequestedFromMe: false,
    commentCount: 0,
    latestComments: [],
    checks: checks(9, 0, 0, NAMES),
    createdAt: hoursAgo(72),
    updatedAt: hoursAgo(1),
    mergedAt: null,
    ...over,
  };
}

export function demoFixtures(): Fixture[] {
  return [
    {
      snap: pr(1207, 'eai-api', 'Add cohort export endpoint', { headRef: 'feat/ENF-1931-cohort-export', checks: checks(7, 1, 1, NAMES), updatedAt: hoursAgo(0.25) }),
      sources: ['auto', 'jira'],
      jiraKey: 'ENF-1931',
      events: [
        { type: 'check_failed', severity: 'attention', text: 'Check failed: lint', hoursAgo: 0.25, unread: true },
        { type: 'new_comment', severity: 'info', text: 'New comment from jalvarez', hoursAgo: 0.5, unread: true },
        { type: 'review_approved', severity: 'info', text: 'Approved by mchen', hoursAgo: 1, unread: true },
        { type: 'new_commit', severity: 'noise', text: 'New commit pushed', hoursAgo: 1.2, unread: false },
        { type: 'first_seen', severity: 'info', text: 'Now tracking this PR', hoursAgo: 48, unread: false },
      ],
      analysis: {
        status: 'done',
        category: 'caused_by_diff',
        confidence: 'high',
        text: 'test_export_csv fails because the new cohort_id column is missing from the fixture. Add the column to tests/fixtures/cohort.csv.',
        log: ['FAILED tests/test_export.py::test_round_trip', 'AssertionError: column "cohort_id" not found in fixture', 'expected 6 columns, got 5'],
      },
    },
    {
      snap: pr(482, 'platform-ui', 'Add cohort filter to retention chart', {
        headRef: 'feat/retention-cohort-filter',
        reviewDecision: 'changes_requested',
        commentCount: 2,
        reviews: [{ reviewer: 'jalvarez', state: 'changes_requested', submittedAt: hoursAgo(0.6), body: 'Move the filter state into the URL so it survives a refresh.' }],
        updatedAt: hoursAgo(0.6),
      }),
      sources: ['auto'],
      events: [{ type: 'changes_requested', severity: 'attention', text: 'jalvarez requested changes', hoursAgo: 0.6, unread: true }, { type: 'new_comment', severity: 'info', text: 'New comment from jalvarez', hoursAgo: 0.6, unread: true }],
    },
    {
      snap: pr(318, 'master-migrator', 'Add index on enrollment term', { headRef: 'feat/enrollment-term-index', mergeState: 'conflict', checks: checks(5, 0, 0, NAMES.slice(0, 5)), updatedAt: hoursAgo(2) }),
      sources: ['auto'],
      events: [{ type: 'merge_conflict', severity: 'attention', text: 'Merge conflict with develop', hoursAgo: 2, unread: true }],
    },
    {
      snap: pr(2290, 'eai-ui', 'Fix tooltip overflow on small screens', { headRef: 'fix/tooltip-overflow', checks: checks(6, 1, 1, NAMES.slice(0, 8)), updatedAt: hoursAgo(0.1) }),
      sources: ['auto'],
      events: [{ type: 'check_failed', severity: 'attention', text: 'Check failed: lint', hoursAgo: 0.1, unread: true }],
      analysis: { status: 'analyzing' },
    },
    {
      snap: pr(1201, 'eai-api', 'Retry S3 upload on timeout', { headRef: 'fix/s3-upload-retry', checks: checks(7, 1, 0, NAMES.slice(0, 8)), updatedAt: hoursAgo(0.85) }),
      sources: ['auto'],
      events: [{ type: 'check_failed', severity: 'attention', text: 'Check failed: lint', hoursAgo: 0.85, unread: true }, { type: 'new_commit', severity: 'noise', text: 'New commit pushed', hoursAgo: 0.9, unread: false }],
      analysis: {
        status: 'done',
        category: 'flaky',
        confidence: 'medium',
        text: 'test_upload_retry timed out on a connection reset. The same test failed 3 of the last 20 runs on develop. Re-run the job.',
        log: ['FAILED tests/test_upload.py::test_backoff', 'TimeoutError: connection reset by peer'],
      },
    },
    {
      snap: pr(477, 'platform-ui', 'Replace date picker', { author: 'dkim', headRef: 'feat/date-picker-v2', reviewRequestedFromMe: true, updatedAt: hoursAgo(24) }),
      sources: ['auto'],
      events: [{ type: 'review_requested', severity: 'attention', text: 'Review requested from you', hoursAgo: 24, unread: false }],
    },
    {
      snap: pr(469, 'platform-ui', 'Refactor settings routes', { headRef: 'chore/settings-routes', updatedAt: hoursAgo(96) }),
      sources: ['auto'],
      events: [{ type: 'stale', severity: 'attention', text: 'No activity for 3+ days', hoursAgo: 20, unread: false }],
    },
    {
      snap: pr(1199, 'eai-api', 'Bump SQLAlchemy to 2.0.36', { headRef: 'chore/sqlalchemy-2.0.36', checks: checks(3, 0, 6, NAMES), updatedAt: hoursAgo(0.07) }),
      sources: ['auto'],
      events: [{ type: 'check_started', severity: 'noise', text: '6 checks started', hoursAgo: 0.07, unread: false }],
    },
    {
      snap: pr(490, 'platform-ui', 'Add term selector to dashboard header', { author: 'dkim', headRef: 'feat/ENF-1987-term-selector', updatedAt: hoursAgo(26) }),
      sources: ['jira'],
      jiraKey: 'ENF-1987',
      events: [{ type: 'ticket_assigned', severity: 'info', text: 'ENF-1987 assigned to you', hoursAgo: 26, unread: true }],
    },
    {
      snap: pr(1210, 'eai-api', 'Paginate institutions list', { author: 'mchen', headRef: 'feat/paginate-institutions', checks: checks(5, 0, 1, NAMES.slice(0, 6)), updatedAt: hoursAgo(2) }),
      sources: ['manual'],
      events: [{ type: 'added_manually', severity: 'info', text: 'Added by you from a GitHub link', hoursAgo: 3, unread: false }],
    },
    {
      snap: pr(1188, 'eai-api', 'Cache Tableau token per org', { headRef: 'perf/tableau-token-cache', reviewDecision: 'approved', updatedAt: hoursAgo(3) }),
      sources: ['auto'],
      events: [{ type: 'review_approved', severity: 'info', text: 'Approved by mchen', hoursAgo: 3, unread: false }],
    },
    {
      snap: pr(2281, 'eai-ui', 'Remove legacy export button', { headRef: 'chore/remove-legacy-export', state: 'merged', mergedAt: hoursAgo(0.02), updatedAt: hoursAgo(0.02) }),
      sources: ['auto'],
      events: [{ type: 'merged', severity: 'info', text: 'Merged into develop', hoursAgo: 0.02, unread: false }],
    },
  ];
}

/** Stand-in for a GitHub lookup in demo mode. PR numbers pick the outcome so every Add PR state can be shown. */
export function demoLookup(owner: string, repo: string, number: number): PrSnapshot | 'no_access' {
  if (number === 404) return 'no_access';
  return pr(number, repo, number === 999 ? 'Old experiment' : `Demo change #${number}`, {
    nodeId: `DEMO_${owner}_${repo}_${number}`,
    repo: `${owner}/${repo}`,
    url: `https://github.com/${owner}/${repo}/pull/${number}`,
    author: 'mchen',
    state: number === 999 ? 'closed' : 'open',
  });
}

export const DEMO_TICKETS = [
  { key: 'ENF-1931', title: 'Cohort export API', status: 'In Progress', statusCategory: 'indeterminate', assignedToMe: true },
  { key: 'ENF-1987', title: 'Term selector in dashboard header', status: 'In Progress', statusCategory: 'indeterminate', assignedToMe: true },
  { key: 'ENF-2044', title: 'Audit export permissions', status: 'To Do', statusCategory: 'new', assignedToMe: true },
];
