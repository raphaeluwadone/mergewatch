export interface PrRef {
  owner: string;
  repo: string;
  number: number;
}

const PR_URL = /^(?:https?:\/\/)?(?:www\.)?github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/pull\/(\d+)(?:[/?#].*)?$/;

export function parsePrUrl(input: string): PrRef | null {
  const match = PR_URL.exec(input.trim());
  if (!match) return null;
  const [, owner, repo, num] = match;
  const number = Number(num);
  if (!owner || !repo || !Number.isSafeInteger(number) || number <= 0) return null;
  return { owner, repo, number };
}

const JIRA_KEY = /\b([A-Z][A-Z0-9]{1,9}-\d{1,7})\b/g;

/** Ticket keys in branch names, titles and bodies. Branches are often lowercase (feat/enf-1931-x), so match case-insensitively and normalize. */
export function extractJiraKeys(...texts: (string | null | undefined)[]): string[] {
  const keys = new Set<string>();
  for (const text of texts) {
    if (!text) continue;
    for (const m of text.toUpperCase().matchAll(JIRA_KEY)) {
      if (m[1]) keys.add(m[1]);
    }
  }
  return [...keys];
}

/** Markdown comment body as a single line of plain text, cut at a word boundary. */
export function commentExcerpt(markdown: string, max = 160): string {
  const text = markdown
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/```[\s\S]*?(```|$)/g, ' [code] ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' [image] ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/^\s{0,3}(#{1,6}|>+|[-*+]|\d+\.)\s+/gm, '')
    .replace(/(\*\*|__|~~)(.*?)\1/g, '$2')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** True when `now` (local time) falls inside quiet hours given as HH:MM; ranges may wrap past midnight. */
export function inQuietHours(start: string | null, end: string | null, now = new Date()): boolean {
  if (!start || !end) return false;
  const mins = now.getHours() * 60 + now.getMinutes();
  const toMins = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  const a = toMins(start);
  const b = toMins(end);
  return a <= b ? mins >= a && mins < b : mins >= a || mins < b;
}
