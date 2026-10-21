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
