import type { ChecksSummary, PrSnapshot, PrStatus, Role, Section, Source } from '@mergewatch/shared';

export function summarizeChecks(snap: PrSnapshot): ChecksSummary {
  let passed = 0;
  let failed = 0;
  let running = 0;
  for (const c of snap.checks) {
    if (c.status === 'failed') failed++;
    else if (c.status === 'running' || c.status === 'queued') running++;
    else passed++;
  }
  return { total: snap.checks.length, passed, failed, running };
}

export function deriveRole(snap: PrSnapshot, myLogin: string, sources: Source[], iReviewed: boolean): Role {
  if (snap.author.toLowerCase() === myLogin.toLowerCase()) return 'author';
  if (snap.reviewRequestedFromMe || iReviewed) return 'reviewer';
  if (sources.includes('jira')) return 'ticket_owner';
  if (sources.includes('manual')) return 'watching';
  return sources.includes('repo') ? 'observer' : 'watching';
}

/** The single status a card shows. Order matters: the first match is what needs the user most. */
export function deriveStatus(snap: PrSnapshot, role: Role, stale: boolean): PrStatus {
  if (snap.state === 'merged') return 'merged';
  // Someone else's PR in a watched repo is context, never something the user must act on.
  if (role === 'observer') return snap.reviewDecision === 'approved' ? 'approved' : 'manual';
  // A reviewer only needs to act when asked; the author owns failures and conflicts.
  if (role === 'reviewer') {
    if (snap.reviewRequestedFromMe) return 'review';
    return snap.reviewDecision === 'approved' ? 'approved' : 'waiting';
  }
  const checks = summarizeChecks(snap);
  if (snap.mergeState === 'conflict') return 'conflict';
  if (checks.failed > 0) return 'failed';
  if (snap.reviewDecision === 'changes_requested') return 'changes';
  // A watched PR only surfaces for problems; otherwise it reads as "Watching".
  if (role === 'watching') return 'manual';
  if (stale) return 'stale';
  if (checks.running > 0) return 'running';
  if (snap.reviewDecision === 'approved') return 'approved';
  return 'waiting';
}

export function sectionFor(status: PrStatus): Section {
  switch (status) {
    case 'failed':
    case 'changes':
    case 'conflict':
    case 'stale':
    case 'review':
      return 'needs';
    case 'running':
    case 'waiting':
    case 'manual':
      return 'waiting';
    case 'approved':
    case 'merged':
      return 'green';
  }
}

/**
 * Whether the user can merge right now. Stricter than GitHub: everything must be green and
 * nothing outstanding, and admin overrides of branch protection are never used.
 */
export function mergeReadiness(snap: PrSnapshot): { ready: boolean; reason: string | null } {
  const no = (reason: string) => ({ ready: false, reason });
  const m = snap.merge;
  if (snap.state !== 'open') return no(snap.state === 'merged' ? 'Already merged.' : 'This PR is closed.');
  if (!m) return no('Waiting for the next sync to check mergeability.');
  if (!m.canWrite) return no("You don't have permission to merge in this repo.");
  if (snap.isDraft) return no('This is a draft PR.');
  if (snap.mergeState === 'conflict' || m.status === 'DIRTY') return no('Resolve the merge conflicts first.');
  const checks = summarizeChecks(snap);
  if (checks.failed) return no(`${checks.failed} ${checks.failed === 1 ? 'check is' : 'checks are'} failing.`);
  if (checks.running) return no('Checks are still running.');
  if (snap.reviewDecision === 'changes_requested') return no('Changes were requested.');
  if (snap.reviewDecision === 'review_required') return no('Needs an approving review.');
  switch (m.status) {
    case 'CLEAN':
    case 'HAS_HOOKS':
      return { ready: true, reason: null };
    case 'BEHIND':
      return no('The branch is behind its base. Update it on GitHub first.');
    case 'BLOCKED':
      return no('Blocked by branch protection rules.');
    case 'UNSTABLE':
      return no('Some checks are not passing.');
    default:
      return no('GitHub is still working out whether this can merge.');
  }
}
