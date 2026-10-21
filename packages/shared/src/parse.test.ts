import { describe, expect, it } from 'vitest';
import { extractJiraKeys, parsePrUrl } from './parse.ts';

describe('parsePrUrl', () => {
  it('parses full and bare PR links', () => {
    expect(parsePrUrl('https://github.com/EnfluxInc/eai-api/pull/1210')).toEqual({ owner: 'EnfluxInc', repo: 'eai-api', number: 1210 });
    expect(parsePrUrl('github.com/a/b/pull/3/files')).toEqual({ owner: 'a', repo: 'b', number: 3 });
    expect(parsePrUrl('  https://github.com/a/b.js/pull/7#discussion  ')).toEqual({ owner: 'a', repo: 'b.js', number: 7 });
  });

  it('rejects non-PR links', () => {
    expect(parsePrUrl('https://github.com/a/b/issues/3')).toBeNull();
    expect(parsePrUrl('https://gitlab.com/a/b/pull/3')).toBeNull();
    expect(parsePrUrl('https://github.com/a/b/pull/0')).toBeNull();
    expect(parsePrUrl('not a url')).toBeNull();
  });
});

describe('extractJiraKeys', () => {
  it('finds keys in branch names regardless of case', () => {
    expect(extractJiraKeys('feat/enf-1931-cohort-export')).toEqual(['ENF-1931']);
    expect(extractJiraKeys('ENF-1987 term selector', 'feat/ENF-1987-x')).toEqual(['ENF-1987']);
  });

  it('ignores text without keys', () => {
    expect(extractJiraKeys('fix/tooltip-overflow', null)).toEqual([]);
  });
});
