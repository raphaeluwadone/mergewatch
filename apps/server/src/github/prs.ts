import type { CheckRun, CheckStatus, MergeState, PrSnapshot, Review, ReviewDecision } from '@mergewatch/shared';
import { graphql, rest } from './client.ts';

const PR_FIELDS = `
fragment PrFields on PullRequest {
  id number title body url state isDraft merged mergedAt createdAt updatedAt
  author { login }
  headRefName baseRefName headRefOid
  mergeable mergeStateStatus reviewDecision
  repository { nameWithOwner }
  reviewRequests(first: 20) { nodes { requestedReviewer { ... on User { login } } } }
  reviews(last: 30) { nodes { author { login } state submittedAt body } }
  comments(last: 20) { totalCount nodes { author { login } createdAt body url } }
  reviewThreads(last: 30) { nodes { isResolved path comments(last: 1) { nodes { author { login } createdAt body url } } } }
  commits(last: 1) {
    nodes { commit { statusCheckRollup { contexts(first: 100) { nodes {
      __typename
      ... on CheckRun { databaseId name status conclusion startedAt completedAt detailsUrl }
      ... on StatusContext { context state targetUrl createdAt }
    } } } } }
  }
}`;

interface RawPr {
  id: string;
  number: number;
  title: string;
  body: string | null;
  url: string;
  state: 'OPEN' | 'CLOSED' | 'MERGED';
  isDraft: boolean;
  merged: boolean;
  mergedAt: string | null;
  createdAt: string;
  updatedAt: string;
  author: { login: string } | null;
  headRefName: string;
  baseRefName: string;
  headRefOid: string;
  mergeable: 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN';
  mergeStateStatus: string;
  reviewDecision: 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | null;
  repository: { nameWithOwner: string };
  reviewRequests: { nodes: { requestedReviewer: { login?: string } | null }[] };
  reviews: { nodes: { author: { login: string } | null; state: string; submittedAt: string | null; body: string }[] };
  comments: { totalCount: number; nodes: RawComment[] };
  reviewThreads: { nodes: { isResolved: boolean; path: string; comments: { nodes: RawComment[] } }[] };
  commits: { nodes: { commit: { statusCheckRollup: { contexts: { nodes: RawContext[] } } | null } }[] };
}

interface RawComment {
  author: { login: string } | null;
  createdAt: string;
  body: string;
  url: string;
}

type RawContext =
  | {
      __typename: 'CheckRun';
      databaseId: number;
      name: string;
      status: string;
      conclusion: string | null;
      startedAt: string | null;
      completedAt: string | null;
      detailsUrl: string | null;
    }
  | { __typename: 'StatusContext'; context: string; state: string; targetUrl: string | null; createdAt: string };

function checkRunStatus(status: string, conclusion: string | null): CheckStatus {
  if (status !== 'COMPLETED') return status === 'IN_PROGRESS' ? 'running' : 'queued';
  switch (conclusion) {
    case 'SUCCESS':
      return 'passed';
    case 'FAILURE':
    case 'TIMED_OUT':
    case 'STARTUP_FAILURE':
    case 'ACTION_REQUIRED':
      return 'failed';
    default:
      return 'skipped';
  }
}

function statusContextStatus(state: string): CheckStatus {
  if (state === 'SUCCESS') return 'passed';
  if (state === 'FAILURE' || state === 'ERROR') return 'failed';
  return 'running';
}

function normalizeChecks(nodes: RawContext[]): CheckRun[] {
  // Re-runs report the same name more than once; the later entry is the current one.
  const byName = new Map<string, CheckRun>();
  for (const n of nodes) {
    if (n.__typename === 'CheckRun') {
      const duration = n.startedAt && n.completedAt ? Math.round((Date.parse(n.completedAt) - Date.parse(n.startedAt)) / 1000) : null;
      const isActionsJob = !!n.detailsUrl?.includes('/actions/runs/');
      byName.set(n.name, {
        name: n.name,
        status: checkRunStatus(n.status, n.conclusion),
        durationSec: duration,
        url: n.detailsUrl,
        jobId: isActionsJob ? n.databaseId : null,
      });
    } else if (n.__typename === 'StatusContext') {
      byName.set(n.context, { name: n.context, status: statusContextStatus(n.state), durationSec: null, url: n.targetUrl, jobId: null });
    }
  }
  return [...byName.values()];
}

function mergeState(pr: RawPr): MergeState {
  if (pr.mergeable === 'CONFLICTING' || pr.mergeStateStatus === 'DIRTY') return 'conflict';
  if (pr.mergeStateStatus === 'BEHIND') return 'behind';
  if (pr.mergeable === 'UNKNOWN') return 'unknown';
  return 'clean';
}

const REVIEW_STATES: Record<string, Review['state']> = {
  APPROVED: 'approved',
  CHANGES_REQUESTED: 'changes_requested',
  COMMENTED: 'commented',
  DISMISSED: 'dismissed',
  PENDING: 'pending',
};

const REVIEW_DECISIONS: Record<string, ReviewDecision> = {
  APPROVED: 'approved',
  CHANGES_REQUESTED: 'changes_requested',
  REVIEW_REQUIRED: 'review_required',
};

export function normalizePr(pr: RawPr, myLogin: string): PrSnapshot {
  const me = myLogin.toLowerCase();
  return {
    nodeId: pr.id,
    repo: pr.repository.nameWithOwner,
    number: pr.number,
    title: pr.title,
    body: pr.body ?? '',
    url: pr.url,
    author: pr.author?.login ?? 'ghost',
    state: pr.merged ? 'merged' : pr.state === 'CLOSED' ? 'closed' : 'open',
    isDraft: pr.isDraft,
    headRef: pr.headRefName,
    baseRef: pr.baseRefName,
    headSha: pr.headRefOid,
    mergeState: mergeState(pr),
    reviewDecision: pr.reviewDecision ? (REVIEW_DECISIONS[pr.reviewDecision] ?? null) : null,
    reviews: pr.reviews.nodes
      .filter((r) => r.submittedAt)
      .map((r) => ({
        reviewer: r.author?.login ?? 'ghost',
        state: REVIEW_STATES[r.state] ?? 'commented',
        submittedAt: r.submittedAt!,
        body: r.body,
      })),
    reviewRequestedFromMe: pr.reviewRequests.nodes.some((n) => n.requestedReviewer?.login?.toLowerCase() === me),
    commentCount: pr.comments.totalCount,
    latestComments: [
      ...pr.comments.nodes.map((c) => ({ author: c.author?.login ?? 'ghost', createdAt: c.createdAt, body: c.body, url: c.url, path: null })),
      // The newest comment of each open inline thread: usually the most actionable feedback.
      ...pr.reviewThreads.nodes
        .filter((t) => !t.isResolved)
        .flatMap((t) => t.comments.nodes.map((c) => ({ author: c.author?.login ?? 'ghost', createdAt: c.createdAt, body: c.body, url: c.url, path: t.path }))),
    ].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    checks: normalizeChecks(pr.commits.nodes[0]?.commit.statusCheckRollup?.contexts.nodes ?? []),
    createdAt: pr.createdAt,
    updatedAt: pr.updatedAt,
    mergedAt: pr.mergedAt,
  };
}

const SEARCH = `${PR_FIELDS}
query($q: String!) {
  search(query: $q, type: ISSUE, first: 50) { nodes { ... on PullRequest { ...PrFields } } }
}`;

/** Open PRs the user authored or was asked to review. */
export async function searchMyPrs(token: string, login: string): Promise<PrSnapshot[]> {
  const queries = [`is:pr is:open archived:false author:${login}`, `is:pr is:open archived:false review-requested:${login}`];
  const results = await Promise.all(
    queries.map((q) => graphql<{ search: { nodes: (RawPr | Record<string, never>)[] } }>(token, SEARCH, { q })),
  );
  const seen = new Map<string, PrSnapshot>();
  for (const r of results) {
    for (const node of r.search.nodes) {
      if ('id' in node) seen.set(node.id, normalizePr(node as RawPr, login));
    }
  }
  return [...seen.values()];
}

const NODES = `${PR_FIELDS}
query($ids: [ID!]!) { nodes(ids: $ids) { ... on PullRequest { ...PrFields } } }`;

/** Refreshes PRs by node id, including ones that have left the search results (merged, closed, review done). */
export async function fetchPrsByIds(token: string, login: string, ids: string[]): Promise<PrSnapshot[]> {
  const out: PrSnapshot[] = [];
  for (let i = 0; i < ids.length; i += 50) {
    const data = await graphql<{ nodes: (RawPr | null)[] }>(token, NODES, { ids: ids.slice(i, i + 50) });
    for (const node of data.nodes) if (node && 'id' in node) out.push(normalizePr(node, login));
  }
  return out;
}

const ONE = `${PR_FIELDS}
query($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) { pullRequest(number: $number) { ...PrFields } }
}`;

export async function fetchPr(token: string, login: string, owner: string, repo: string, number: number): Promise<PrSnapshot | null> {
  const data = await graphql<{ repository: { pullRequest: RawPr | null } | null }>(token, ONE, { owner, repo, number });
  const pr = data.repository?.pullRequest;
  return pr ? normalizePr(pr, login) : null;
}

const OPEN_IN_REPO = `
query($owner: String!, $repo: String!) {
  repository(owner: $owner, name: $repo) {
    pullRequests(states: OPEN, first: 100, orderBy: { field: UPDATED_AT, direction: DESC }) {
      nodes { id title headRefName }
    }
  }
}`;

/** Light listing used to match Jira ticket keys against branch names and titles. */
export async function listOpenPrHeads(token: string, fullName: string) {
  const [owner, repo] = fullName.split('/');
  const data = await graphql<{ repository: { pullRequests: { nodes: { id: string; title: string; headRefName: string }[] } } | null }>(
    token,
    OPEN_IN_REPO,
    { owner, repo },
  );
  return data.repository?.pullRequests.nodes ?? [];
}

export interface GithubUser {
  id: number;
  login: string;
  name: string | null;
  avatar_url: string;
}

export const getViewer = (token: string) => rest<GithubUser>(token, '/user');

export interface RepoSummary {
  fullName: string;
  private: boolean;
  pushedAt: string | null;
}

export async function listMyRepos(token: string): Promise<RepoSummary[]> {
  const repos: RepoSummary[] = [];
  for (let page = 1; page <= 5; page++) {
    const batch = await rest<{ full_name: string; private: boolean; pushed_at: string | null; archived: boolean }[]>(
      token,
      `/user/repos?per_page=100&page=${page}&sort=pushed&affiliation=owner,collaborator,organization_member`,
    );
    for (const r of batch) if (!r.archived) repos.push({ fullName: r.full_name, private: r.private, pushedAt: r.pushed_at });
    if (batch.length < 100) break;
  }
  return repos;
}
