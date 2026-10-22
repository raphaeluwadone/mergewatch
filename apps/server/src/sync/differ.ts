import { commentExcerpt, type CheckRun, type Comment, type EventType, type PrSnapshot, type Role, type Severity } from '@mergewatch/shared';

export interface DiffEvent {
  type: EventType;
  severity: Severity;
  text: string;
  detail?: string;
}

export interface DiffContext {
  myLogin: string;
  role: Role;
  now: Date;
  staleDays: number;
  /** When the last `stale` event was emitted for this PR, if any. */
  lastStaleAt: Date | null;
}

const byName = (checks: CheckRun[]) => new Map(checks.map((c) => [c.name, c]));
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export function isStale(snap: PrSnapshot, ctx: Pick<DiffContext, 'now' | 'staleDays' | 'role'>): boolean {
  if (snap.state !== 'open' || snap.isDraft) return false;
  if (ctx.role === 'reviewer' || ctx.role === 'watching') return false;
  const ageMs = ctx.now.getTime() - new Date(snap.updatedAt).getTime();
  return ageMs >= ctx.staleDays * 24 * 60 * 60 * 1000;
}

/** Events describing what changed between two snapshots of the same PR. `prev` is null the first time a PR is seen. */
export function diffSnapshots(prev: PrSnapshot | null, next: PrSnapshot, ctx: DiffContext): DiffEvent[] {
  const events: DiffEvent[] = [];
  const add = (type: EventType, severity: Severity, text: string, detail?: string) =>
    events.push(detail ? { type, severity, text, detail } : { type, severity, text });

  if (!prev) {
    add('first_seen', 'info', ctx.role === 'reviewer' ? 'Now tracking: review requested from you' : 'Now tracking this PR');
    if (next.state === 'open') {
      for (const c of next.checks) if (c.status === 'failed') add('check_failed', 'attention', `Check failed: ${c.name}`);
      if (next.mergeState === 'conflict') add('merge_conflict', 'attention', `Merge conflict with ${next.baseRef}`);
      if (next.reviewDecision === 'changes_requested' && ctx.role !== 'reviewer') {
        const r = latestChangeRequest(next);
        add('changes_requested', 'attention', r ? `${r.reviewer} requested changes` : 'Changes requested');
      }
      if (next.reviewRequestedFromMe) add('review_requested', 'attention', 'Review requested from you');
    }
    return events;
  }

  if (prev.state === 'open' && next.state === 'merged') {
    add('merged', 'info', `Merged into ${next.baseRef}`);
    return events;
  }
  if (prev.state === 'open' && next.state === 'closed') {
    add('closed', 'info', 'Closed without merging');
    return events;
  }

  const newCommit = prev.headSha !== next.headSha;
  if (newCommit) {
    add('new_commit', same(next.author, ctx.myLogin) ? 'noise' : 'info', 'New commit pushed');
  }

  const prevChecks = byName(prev.checks);
  const started: string[] = [];
  for (const c of next.checks) {
    const before = prevChecks.get(c.name);
    const wasFailedOnSameCommit = !newCommit && before?.status === 'failed';
    if (c.status === 'failed' && !wasFailedOnSameCommit) {
      add('check_failed', 'attention', `Check failed: ${c.name}`);
    } else if (c.status === 'passed' && before?.status === 'failed') {
      add('check_recovered', 'info', `Check recovered: ${c.name}`);
    } else if ((c.status === 'running' || c.status === 'queued') && (newCommit || (before && before.status !== 'running' && before.status !== 'queued'))) {
      started.push(c.name);
    }
  }
  if (started.length > 0) {
    add('check_started', 'noise', started.length === 1 ? `Check started: ${started[0]}` : `${started.length} checks started`);
  }

  const seenReviews = new Set(prev.reviews.map((r) => `${r.reviewer}@${r.submittedAt}`));
  for (const r of next.reviews) {
    if (seenReviews.has(`${r.reviewer}@${r.submittedAt}`) || same(r.reviewer, ctx.myLogin)) continue;
    const note = r.body.trim() ? commentExcerpt(r.body) : undefined;
    if (r.state === 'changes_requested') {
      add('changes_requested', ctx.role === 'reviewer' ? 'info' : 'attention', `${r.reviewer} requested changes`, note);
    } else if (r.state === 'approved') {
      add('review_approved', 'info', `Approved by ${r.reviewer}`, note);
    } else if (r.state === 'commented' && note) {
      add('new_comment', 'info', `New review comment from ${r.reviewer}`, note);
    }
  }

  if (!prev.reviewRequestedFromMe && next.reviewRequestedFromMe) {
    add('review_requested', 'attention', 'Review requested from you');
  }

  const seenComments = new Set(prev.latestComments.map((c) => `${c.author}@${c.createdAt}`));
  // Comments older than the previous snapshot were already there, even if an older fetch didn't include them.
  const unseen = next.latestComments.filter((c) => !seenComments.has(`${c.author}@${c.createdAt}`) && c.createdAt > prev.updatedAt);
  const freshComments = unseen.filter((c) => !same(c.author, ctx.myLogin));
  const mine = unseen.filter((c) => same(c.author, ctx.myLogin));
  if (freshComments.length === 1) {
    const c = freshComments[0]!;
    add('new_comment', 'info', `New comment from ${c.author}${c.path ? ` on ${shortPath(c.path)}` : ''}`, commentExcerpt(c.body));
  } else if (freshComments.length > 1) {
    const last = freshComments[freshComments.length - 1]!;
    add('new_comment', 'info', `${freshComments.length} new comments`, `${last.author}: ${commentExcerpt(last.body)}`);
  }
  // Your own comments belong in the timeline but aren't news, so they never count as unread.
  if (mine.length) add('new_comment', 'noise', 'You commented', commentExcerpt(mine[mine.length - 1]!.body));

  if (prev.mergeState !== 'conflict' && next.mergeState === 'conflict') {
    add('merge_conflict', 'attention', `Merge conflict with ${next.baseRef}`);
  } else if (prev.mergeState === 'conflict' && next.mergeState !== 'conflict' && next.mergeState !== 'unknown') {
    add('conflict_resolved', 'info', 'Merge conflict resolved');
  } else if (prev.mergeState === 'clean' && next.mergeState === 'behind') {
    add('behind_base', 'info', `Behind ${next.baseRef}`);
  }

  if (isStale(next, ctx)) {
    const lastActivity = new Date(next.updatedAt);
    if (!ctx.lastStaleAt || ctx.lastStaleAt < lastActivity) {
      add('stale', 'attention', `No activity for ${ctx.staleDays}+ days`);
    }
  }

  return events;
}

const shortPath = (path: string) => path.split('/').slice(-2).join('/');

/** The newest comment or review note from someone other than the user. */
export function latestCommentFromOthers(snap: PrSnapshot, myLogin: string): Comment | null {
  const fromReviews: Comment[] = snap.reviews
    .filter((r) => r.body.trim())
    .map((r) => ({ author: r.reviewer, createdAt: r.submittedAt, body: r.body, url: null, path: null }));
  const all = [...snap.latestComments, ...fromReviews].filter((c) => !same(c.author, myLogin) && c.body.trim());
  all.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return all[all.length - 1] ?? null;
}

export function latestChangeRequest(snap: PrSnapshot) {
  return [...snap.reviews].reverse().find((r) => r.state === 'changes_requested') ?? null;
}
