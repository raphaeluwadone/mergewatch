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
  return 'watching';
}

/** The single status a card shows. Order matters: the first match is what needs the user most. */
export function deriveStatus(snap: PrSnapshot, role: Role, stale: boolean): PrStatus {
  if (snap.state === 'merged') return 'merged';
  // A reviewer only needs to act when asked; the author owns failures and conflicts.
  if (role === 'reviewer') {
    if (snap.reviewRequestedFromMe) return 'review';
    return snap.reviewDecision === 'approved' ? 'approved' : 'waiting';
  }
  const checks = summarizeChecks(snap);
  if (snap.mergeState === 'conflict') return 'conflict';
  if (checks.failed > 0) return 'failed';
  if (snap.reviewDecision === 'changes_requested') return 'changes';
  if (stale) return 'stale';
  if (checks.running > 0) return 'running';
  if (snap.reviewDecision === 'approved') return 'approved';
  if (role === 'watching') return 'manual';
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
