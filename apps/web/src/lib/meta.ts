import type { AgentCategory, PrStatus } from '@mergewatch/shared';

export const STATUS: Record<PrStatus, { label: string; color: string; soft: string }> = {
  failed: { label: 'Check failed', color: 'var(--danger)', soft: 'var(--danger-soft)' },
  changes: { label: 'Changes requested', color: 'var(--danger)', soft: 'var(--danger-soft)' },
  conflict: { label: 'Merge conflict', color: 'var(--danger)', soft: 'var(--danger-soft)' },
  review: { label: 'Waiting on your review', color: 'var(--danger)', soft: 'var(--danger-soft)' },
  stale: { label: 'Stale', color: 'var(--warn)', soft: 'var(--warn-soft)' },
  running: { label: 'Checks running', color: 'var(--info)', soft: 'var(--info-soft)' },
  waiting: { label: 'Awaiting review', color: 'var(--info)', soft: 'var(--info-soft)' },
  manual: { label: 'Watching', color: 'var(--info)', soft: 'var(--info-soft)' },
  approved: { label: 'Approved', color: 'var(--success)', soft: 'var(--success-soft)' },
  merged: { label: 'Merged', color: 'var(--success)', soft: 'var(--success-soft)' },
};

export const CATEGORY: Record<AgentCategory, { label: string; color: string }> = {
  caused_by_diff: { label: 'Caused by diff', color: 'var(--danger)' },
  flaky: { label: 'Flaky', color: 'var(--warn)' },
  infra: { label: 'Infra', color: 'var(--info)' },
  conflict: { label: 'Conflict', color: 'var(--danger)' },
  reviewer_action: { label: 'Reviewer action', color: 'var(--accent-purple)' },
};
