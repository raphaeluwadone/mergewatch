import type { EventType, Severity } from '@mergewatch/shared';

export interface NotifyItem {
  prId: number;
  repo: string;
  number: number;
  title: string;
  type: EventType;
  severity: Severity;
  text: string;
  detail: string | null;
}

export interface PushMessage {
  title: string;
  body: string;
  url: string;
  /** Same tag replaces an earlier notification for the PR instead of stacking. */
  tag: string;
  /** Set when the server plays its own sound, so the browser doesn't play a second one. */
  silent?: boolean;
}

const NOTIFY_INFO: EventType[] = ['new_comment', 'review_approved', 'merged', 'ticket_assigned'];

/** Whether an event is worth a push: anything needing attention, plus comments from others, approvals, merges and Jira assignments. */
export function shouldNotify(e: { type: EventType; severity: Severity }, muted: boolean): boolean {
  if (e.severity === 'attention') return true;
  if (muted || e.severity === 'noise') return false;
  return NOTIFY_INFO.includes(e.type);
}

const MAX_BODY = 180;
const clip = (s: string) => (s.length > MAX_BODY ? `${s.slice(0, MAX_BODY - 1)}…` : s);

/** One message per PR, leading with the most urgent event. */
export function buildPushMessages(items: NotifyItem[]): PushMessage[] {
  const byPr = new Map<number, NotifyItem[]>();
  for (const item of items) byPr.set(item.prId, [...(byPr.get(item.prId) ?? []), item]);

  return [...byPr.values()].map((group) => {
    const sorted = [...group].sort((a, b) => Number(b.severity === 'attention') - Number(a.severity === 'attention'));
    const lead = sorted[0]!;
    const repo = lead.repo.split('/').pop();
    const needs = sorted.some((i) => i.severity === 'attention');
    const line = lead.detail ? `${lead.text}: ${lead.detail}` : lead.text;
    const more = sorted.length > 1 ? ` (+${sorted.length - 1} more)` : '';
    return {
      title: `${repo} #${lead.number}${needs ? ' needs you' : ''}`,
      body: clip(`${lead.title}\n${line}${more}`),
      url: `/pr/${lead.prId}`,
      tag: `mw-pr-${lead.prId}`,
    };
  });
}
