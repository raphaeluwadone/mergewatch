import { describe, expect, it } from 'vitest';
import type { PrSnapshot } from '@mergewatch/shared';
import { diffSnapshots, type DiffContext } from './differ.ts';
import { deriveRole, deriveStatus, mergeReadiness, sectionFor } from './status.ts';

const NOW = new Date('2026-10-20T12:00:00Z');

function snap(over: Partial<PrSnapshot> = {}): PrSnapshot {
  return {
    nodeId: 'PR_1',
    repo: 'EnfluxInc/eai-api',
    number: 1207,
    title: 'Add cohort export endpoint',
    body: '',
    url: 'https://github.com/EnfluxInc/eai-api/pull/1207',
    author: 'me',
    state: 'open',
    isDraft: false,
    headRef: 'feat/cohort-export',
    baseRef: 'develop',
    headSha: 'aaa',
    mergeState: 'clean',
    reviewDecision: 'review_required',
    reviews: [],
    reviewRequestedFromMe: false,
    commentCount: 0,
    latestComments: [],
    checks: [{ name: 'unit tests', status: 'passed', durationSec: 60, url: null, jobId: 1 }],
    createdAt: '2026-10-19T10:00:00Z',
    updatedAt: '2026-10-20T11:00:00Z',
    mergedAt: null,
    ...over,
  };
}

const ctx: DiffContext = { myLogin: 'me', role: 'author', now: NOW, staleDays: 3, lastStaleAt: null };
const types = (prev: PrSnapshot | null, next: PrSnapshot, c: Partial<DiffContext> = {}) =>
  diffSnapshots(prev, next, { ...ctx, ...c }).map((e) => `${e.type}:${e.severity}`);

describe('diffSnapshots', () => {
  it('reports nothing when nothing changed', () => {
    expect(types(snap(), snap())).toEqual([]);
  });

  it('flags a newly failed check as attention', () => {
    const next = snap({ checks: [{ name: 'unit tests', status: 'failed', durationSec: 60, url: null, jobId: 1 }] });
    expect(types(snap(), next)).toEqual(['check_failed:attention']);
  });

  it('does not repeat a failure on the same commit', () => {
    const failed = snap({ checks: [{ name: 'unit tests', status: 'failed', durationSec: 60, url: null, jobId: 1 }] });
    expect(types(failed, failed)).toEqual([]);
  });

  it('reports a fresh failure after a new commit', () => {
    const failed = snap({ checks: [{ name: 'unit tests', status: 'failed', durationSec: 60, url: null, jobId: 1 }] });
    expect(types(failed, { ...failed, headSha: 'bbb' })).toEqual(['new_commit:noise', 'check_failed:attention']);
  });

  it('treats my own push as noise and someone else pushing as info', () => {
    expect(types(snap(), snap({ headSha: 'bbb' }))).toEqual(['new_commit:noise']);
    expect(types(snap({ author: 'dkim' }), snap({ author: 'dkim', headSha: 'bbb' }), { role: 'ticket_owner' })).toEqual(['new_commit:info']);
  });

  it('collapses started checks into one noise event', () => {
    const next = snap({
      headSha: 'bbb',
      checks: [
        { name: 'unit tests', status: 'running', durationSec: null, url: null, jobId: 2 },
        { name: 'lint', status: 'queued', durationSec: null, url: null, jobId: 3 },
      ],
    });
    expect(types(snap(), next)).toEqual(['new_commit:noise', 'check_started:noise']);
  });

  it('reports recovery as info', () => {
    const failed = snap({ checks: [{ name: 'unit tests', status: 'failed', durationSec: 60, url: null, jobId: 1 }] });
    expect(types(failed, snap({ headSha: 'bbb' }))).toEqual(['new_commit:noise', 'check_recovered:info']);
  });

  it('reports reviews from others, not my own', () => {
    const next = snap({
      reviews: [
        { reviewer: 'jalvarez', state: 'changes_requested', submittedAt: '2026-10-20T11:30:00Z', body: 'Move state to URL' },
        { reviewer: 'me', state: 'commented', submittedAt: '2026-10-20T11:31:00Z', body: 'ok' },
      ],
    });
    expect(types(snap(), next)).toEqual(['changes_requested:attention']);
  });

  it('reports comments from others as news and my own as timeline noise', () => {
    const next = snap({
      latestComments: [
        { author: 'jalvarez', createdAt: '2026-10-20T11:40:00Z', body: 'hi' },
        { author: 'me', createdAt: '2026-10-20T11:41:00Z', body: 'hey' },
      ],
    });
    expect(diffSnapshots(snap(), next, ctx)).toEqual([
      { type: 'new_comment', severity: 'info', text: 'New comment from jalvarez', detail: 'hi' },
      { type: 'new_comment', severity: 'noise', text: 'You commented', detail: 'hey' },
    ]);
  });

  it('names the file for inline review comments and ignores comments older than the last poll', () => {
    const next = snap({
      latestComments: [
        { author: 'mchen', createdAt: '2026-10-19T09:00:00Z', body: 'old, newly fetched', url: null, path: null },
        { author: 'jalvarez', createdAt: '2026-10-20T11:40:00Z', body: '**Use** the shared helper', url: null, path: 'api/controllers/cohort/export.py' },
      ],
    });
    expect(diffSnapshots(snap(), next, ctx)).toEqual([
      { type: 'new_comment', severity: 'info', text: 'New comment from jalvarez on cohort/export.py', detail: 'Use the shared helper' },
    ]);
  });

  it('records my own comment alone without making it unread', () => {
    const next = snap({ latestComments: [{ author: 'me', createdAt: '2026-10-20T11:41:00Z', body: 'hey' }] });
    expect(types(snap(), next)).toEqual(['new_comment:noise']);
  });

  it('tracks conflicts appearing and resolving', () => {
    expect(types(snap(), snap({ mergeState: 'conflict' }))).toEqual(['merge_conflict:attention']);
    expect(types(snap({ mergeState: 'conflict' }), snap())).toEqual(['conflict_resolved:info']);
    expect(types(snap(), snap({ mergeState: 'behind' }))).toEqual(['behind_base:info']);
  });

  it('flags a stale PR once per quiet period', () => {
    const old = snap({ updatedAt: '2026-10-16T11:00:00Z' });
    expect(types(old, old)).toEqual(['stale:attention']);
    expect(types(old, old, { lastStaleAt: new Date('2026-10-19T12:00:00Z') })).toEqual([]);
    expect(types(old, old, { role: 'reviewer' })).toEqual([]);
  });

  it('stops at merge', () => {
    expect(types(snap(), snap({ state: 'merged', mergedAt: '2026-10-20T11:59:00Z' }))).toEqual(['merged:info']);
  });

  it('describes current problems when first seen', () => {
    const next = snap({ mergeState: 'conflict', checks: [{ name: 'e2e', status: 'failed', durationSec: 1, url: null, jobId: 9 }] });
    expect(types(null, next)).toEqual(['first_seen:info', 'check_failed:attention', 'merge_conflict:attention']);
  });
});

describe('deriveStatus', () => {
  it('puts conflicts and failures in Needs you', () => {
    expect(deriveStatus(snap({ mergeState: 'conflict' }), 'author', false)).toBe('conflict');
    const failed = snap({ checks: [{ name: 'x', status: 'failed', durationSec: 1, url: null, jobId: 1 }] });
    expect(deriveStatus(failed, 'author', false)).toBe('failed');
    expect(sectionFor('failed')).toBe('needs');
  });

  it('does not blame a reviewer for the author’s failing checks', () => {
    const failed = snap({ author: 'dkim', checks: [{ name: 'x', status: 'failed', durationSec: 1, url: null, jobId: 1 }] });
    expect(deriveStatus(failed, 'reviewer', false)).toBe('waiting');
    expect(deriveStatus({ ...failed, reviewRequestedFromMe: true }, 'reviewer', false)).toBe('review');
  });

  it('shows running, approved, watching and merged states', () => {
    expect(deriveStatus(snap({ checks: [{ name: 'x', status: 'running', durationSec: null, url: null, jobId: 1 }] }), 'author', false)).toBe('running');
    expect(deriveStatus(snap({ reviewDecision: 'approved' }), 'author', false)).toBe('approved');
    expect(deriveStatus(snap({ author: 'x' }), 'watching', false)).toBe('manual');
    expect(deriveStatus(snap({ author: 'x', checks: [{ name: 'x', status: 'running', durationSec: null, url: null, jobId: 1 }] }), 'watching', false)).toBe('manual');
    expect(deriveStatus(snap({ author: 'x', mergeState: 'conflict' }), 'watching', false)).toBe('conflict');
    expect(deriveStatus(snap({ state: 'merged' }), 'author', false)).toBe('merged');
    expect(deriveStatus(snap(), 'author', true)).toBe('stale');
  });
});

describe('watched-repo PRs (observer)', () => {
  const observer = { role: 'observer' as const };
  const failed = snap({ author: 'dkim', checks: [{ name: 'e2e', status: 'failed', durationSec: 1, url: null, jobId: 1 }] });

  it('arrive quietly', () => {
    expect(types(null, failed, observer)).toEqual(['first_seen:noise']);
  });

  it('never need the user, even when checks fail', () => {
    expect(types(snap({ author: 'dkim' }), failed, observer)).toEqual(['check_failed:info']);
    expect(deriveStatus(failed, 'observer', false)).toBe('manual');
    expect(sectionFor(deriveStatus(failed, 'observer', false))).toBe('waiting');
    expect(deriveStatus(snap({ author: 'dkim', reviewDecision: 'approved' }), 'observer', false)).toBe('approved');
  });

  it('are never stale for the user', () => {
    const old = snap({ author: 'dkim', updatedAt: '2026-10-01T00:00:00Z' });
    expect(types(old, old, observer)).toEqual([]);
  });
});

describe('deriveRole', () => {
  it('lets the user’s own involvement win over a repo watch', () => {
    const theirs = snap({ author: 'dkim' });
    expect(deriveRole(theirs, 'me', ['repo'], false)).toBe('observer');
    expect(deriveRole(theirs, 'me', ['repo', 'manual'], false)).toBe('watching');
    expect(deriveRole(theirs, 'me', ['repo', 'jira'], false)).toBe('ticket_owner');
    expect(deriveRole({ ...theirs, reviewRequestedFromMe: true }, 'me', ['repo'], false)).toBe('reviewer');
    expect(deriveRole(snap(), 'me', ['repo'], false)).toBe('author');
  });
});

describe('mergeReadiness', () => {
  const merge = {
    status: 'CLEAN',
    methods: ['squash', 'merge'] as ('squash' | 'merge')[],
    defaultMethod: 'squash' as const,
    autoMergeAllowed: true,
    autoMerge: null,
    canEnableAutoMerge: true,
    canDisableAutoMerge: false,
    queue: false,
    deleteBranchOnMerge: false,
    sameRepo: true,
    canWrite: true,
  };
  const ready = (over: Partial<PrSnapshot> = {}, m: Partial<typeof merge> = {}) =>
    mergeReadiness(snap({ reviewDecision: 'approved', merge: { ...merge, ...m }, ...over }));

  it('is ready only when everything is green and approved', () => {
    expect(ready()).toEqual({ ready: true, reason: null });
    expect(ready({ reviewDecision: null })).toEqual({ ready: true, reason: null });
  });

  it('explains every blocker in plain words', () => {
    expect(ready({ isDraft: true }).reason).toBe('This is a draft PR.');
    expect(ready({ mergeState: 'conflict' }).reason).toBe('Resolve the merge conflicts first.');
    expect(ready({ checks: [{ name: 'x', status: 'failed', durationSec: 1, url: null, jobId: 1 }] }).reason).toBe('1 check is failing.');
    expect(ready({ checks: [{ name: 'x', status: 'running', durationSec: null, url: null, jobId: 1 }] }).reason).toBe('Checks are still running.');
    expect(ready({ reviewDecision: 'review_required' }).reason).toBe('Needs an approving review.');
    expect(ready({ reviewDecision: 'changes_requested' }).reason).toBe('Changes were requested.');
    expect(ready({}, { status: 'BLOCKED' }).reason).toBe('Blocked by branch protection rules.');
    expect(ready({}, { status: 'BEHIND' }).ready).toBe(false);
    expect(ready({}, { status: 'UNSTABLE' }).ready).toBe(false);
    expect(ready({}, { canWrite: false }).reason).toBe("You don't have permission to merge in this repo.");
    expect(ready({ state: 'merged' }).reason).toBe('Already merged.');
    expect(mergeReadiness(snap({ reviewDecision: 'approved' })).ready).toBe(false);
  });
});
