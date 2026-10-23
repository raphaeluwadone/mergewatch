import { describe, expect, it } from 'vitest';
import { buildPushMessages, shouldNotify, type NotifyItem } from './messages.ts';

const item = (over: Partial<NotifyItem>): NotifyItem => ({
  prId: 7,
  repo: 'EnfluxInc/eai-api',
  number: 1207,
  title: 'Add cohort export endpoint',
  type: 'new_comment',
  severity: 'info',
  text: 'New comment from jalvarez',
  detail: 'Can we stream this?',
  ...over,
});

describe('shouldNotify', () => {
  it('notifies for attention, comments, approvals, merges and Jira assignments', () => {
    expect(shouldNotify({ type: 'check_failed', severity: 'attention' }, false)).toBe(true);
    expect(shouldNotify({ type: 'new_comment', severity: 'info' }, false)).toBe(true);
    expect(shouldNotify({ type: 'review_approved', severity: 'info' }, false)).toBe(true);
    expect(shouldNotify({ type: 'merged', severity: 'info' }, false)).toBe(true);
    expect(shouldNotify({ type: 'ticket_assigned', severity: 'info' }, false)).toBe(true);
  });

  it('stays quiet for noise, other info, and muted PRs unless something needs you', () => {
    expect(shouldNotify({ type: 'new_comment', severity: 'noise' }, false)).toBe(false);
    expect(shouldNotify({ type: 'behind_base', severity: 'info' }, false)).toBe(false);
    expect(shouldNotify({ type: 'new_comment', severity: 'info' }, true)).toBe(false);
    expect(shouldNotify({ type: 'check_failed', severity: 'attention' }, true)).toBe(true);
  });
});

describe('buildPushMessages', () => {
  it('sends one message per PR, leading with what needs you', () => {
    const msgs = buildPushMessages([
      item({}),
      item({ type: 'check_failed', severity: 'attention', text: 'Check failed: lint', detail: null }),
      item({ prId: 9, number: 482, repo: 'EnfluxInc/platform-ui', title: 'Cohort filter', type: 'review_approved', text: 'Approved by mchen', detail: null }),
    ]);
    expect(msgs).toEqual([
      { title: 'eai-api #1207 needs you', body: 'Add cohort export endpoint\nCheck failed: lint (+1 more)', url: '/pr/7', tag: 'mw-pr-7' },
      { title: 'platform-ui #482', body: 'Cohort filter\nApproved by mchen', url: '/pr/9', tag: 'mw-pr-9' },
    ]);
  });

  it('includes the comment excerpt', () => {
    expect(buildPushMessages([item({})])[0]!.body).toBe('Add cohort export endpoint\nNew comment from jalvarez: Can we stream this?');
  });
});

describe('shouldNotify for watched-repo PRs', () => {
  it('only notifies for comments and approvals', () => {
    expect(shouldNotify({ type: 'new_comment', severity: 'info' }, false, true)).toBe(true);
    expect(shouldNotify({ type: 'review_approved', severity: 'info' }, false, true)).toBe(true);
    expect(shouldNotify({ type: 'check_failed', severity: 'info' }, false, true)).toBe(false);
    expect(shouldNotify({ type: 'merged', severity: 'info' }, false, true)).toBe(false);
    expect(shouldNotify({ type: 'new_comment', severity: 'info' }, true, true)).toBe(false);
  });
});
