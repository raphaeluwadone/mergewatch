import type { ChecksSummary, PrView, Source } from '@mergewatch/shared';

export function timeAgo(iso: string | null, now = Date.now()): string {
  if (!iso) return 'never';
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hr ago`;
  const d = Math.round(h / 24);
  return d === 1 ? '1 day ago' : `${d} days ago`;
}

export function shortAgo(iso: string | null, now = Date.now()): string {
  if (!iso) return '';
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return `${s}s ago`;
  return timeAgo(iso, now);
}

export const repoName = (fullName: string) => fullName.split('/').pop() ?? fullName;

export function checksLine(c: ChecksSummary): string {
  if (c.total === 0) return 'No checks';
  const parts = [`${c.passed} of ${c.total} passed`];
  if (c.failed) parts.push(`${c.failed} failed`);
  if (c.running) parts.push(`${c.running} running`);
  return parts.join(', ');
}

export function sourceLabels(pr: Pick<PrView, 'sources' | 'jira'>): string[] {
  return pr.sources
    .map((s: Source) => (s === 'manual' ? 'Added by you' : s === 'jira' ? `${pr.jira?.key ?? 'Jira'} · via Jira` : null))
    .filter((x): x is string => x !== null);
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
