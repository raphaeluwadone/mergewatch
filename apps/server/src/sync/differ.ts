import type { CheckRun, EventType, PrSnapshot, Role, Severity } from '@mergewatch/shared';

export interface DiffEvent {
  type: EventType;
  severity: Severity;
  text: string;
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
  if (ctx.role === 'reviewer') return false;
  const ageMs = ctx.now.getTime() - new Date(snap.updatedAt).getTime();
  return ageMs >= ctx.staleDays * 24 * 60 * 60 * 1000;
}

/** Events describing what changed between two snapshots of the same PR. `prev` is null the first time a PR is seen. */
export function diffSnapshots(prev: PrSnapshot | null, next: PrSnapshot, ctx: DiffContext): DiffEvent[] {
  const events: DiffEvent[] = [];
  const add = (type: EventType, severity: Severity, text: string) => events.push({ type, severity, text });

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
    if (r.state === 'changes_requested') {
      add('changes_requested', ctx.role === 'reviewer' ? 'info' : 'attention', `${r.reviewer} requested changes`);
    } else if (r.state === 'approved') {
      add('review_approved', 'info', `Approved by ${r.reviewer}`);
    } else if (r.state === 'commented' && r.body.trim()) {
      add('new_comment', 'info', `New review comment from ${r.reviewer}`);
    }
  }

  if (!prev.reviewRequestedFromMe && next.reviewRequestedFromMe) {
    add('review_requested', 'attention', 'Review requested from you');
  }

  const seenComments = new Set(prev.latestComments.map((c) => `${c.author}@${c.createdAt}`));
  const freshComments = next.latestComments.filter((c) => !seenComments.has(`${c.author}@${c.createdAt}`) && !same(c.author, ctx.myLogin));
  if (freshComments.length === 1) add('new_comment', 'info', `New comment from ${freshComments[0]!.author}`);
  else if (freshComments.length > 1) add('new_comment', 'info', `${freshComments.length} new comments`);

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

export function latestChangeRequest(snap: PrSnapshot) {
  return [...snap.reviews].reverse().find((r) => r.state === 'changes_requested') ?? null;
}
