import { GITHUB_QUERY_MAX_CHARS, longestGithubQuery } from '@lead-hunter/contracts';
import { describe, expect, it } from 'vitest';
import { buildQueries } from './query.js';

describe('buildQueries', () => {
  it('builds one query per language, quoting labels with spaces', () => {
    expect(
      buildQueries({ labels: ['bounty', 'paid', '💎 Bounty'], languages: ['TypeScript', 'Go'] }),
    ).toEqual([
      {
        q: 'is:issue is:open archived:false label:bounty,paid,"💎 Bounty" language:"TypeScript"',
        language: 'TypeScript',
      },
      {
        q: 'is:issue is:open archived:false label:bounty,paid,"💎 Bounty" language:"Go"',
        language: 'Go',
      },
    ]);
  });

  it('builds a single query without a language when none is configured', () => {
    expect(buildQueries({ labels: ['bounty'], languages: [] })).toEqual([
      { q: 'is:issue is:open archived:false label:bounty', language: null },
    ]);
  });

  it('never builds a query longer than the contract bound', () => {
    const config = {
      labels: Array.from({ length: 5 }, (_, n) => `label ${n}`.padEnd(30, 'x')),
      languages: ['Jupyter Notebook', 'Objective-C', 'TypeScript'] as (
        'Jupyter Notebook' | 'Objective-C' | 'TypeScript'
      )[],
    };
    const longest = longestGithubQuery(config.labels, config.languages);
    expect(longest).toBeLessThanOrEqual(GITHUB_QUERY_MAX_CHARS);
    for (const { q } of buildQueries(config)) expect(q.length).toBeLessThanOrEqual(longest);
    expect(Math.max(...buildQueries(config).map(({ q }) => q.length))).toBe(longest);
  });
});
