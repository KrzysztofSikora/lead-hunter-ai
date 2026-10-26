import { describe, expect, it } from 'vitest';
import { mapIssue, type MapContext } from './map-issue.js';
import { buildQueries, searchPath } from './query.js';
import { limitWaitMs } from './api.js';
import { GithubSearchConfig } from '@lead-hunter/contracts';

const context: MapContext = { platform: 'github', language: 'TypeScript', maxTextChars: 200 };
const issue = (over: object = {}) => ({
  html_url: 'https://github.com/demo/repo/issues/7',
  title: 'DEMO: fix [$200]',
  body: 'Body line',
  created_at: '2026-09-01T10:00:00Z',
  labels: [{ name: 'bounty' }],
  ...over,
});

describe('mapIssue (S-19 D-6)', () => {
  it('builds the labelled text, the key, the url and the facts', () => {
    const mapped = mapIssue(issue(), context);
    expect(mapped).toMatchObject({
      key: 'github:demo/repo#7',
      url: 'https://github.com/demo/repo/issues/7',
      title: 'DEMO: fix [$200]',
      publishedAt: null,
      bounty: {
        platform: 'github',
        repository: 'demo/repo',
        issueNumber: 7,
        labels: ['bounty'],
        reward: { amountMinor: 20_000, currency: 'USD', quote: '$200' },
      },
    });
    expect((mapped as { text: string }).text).toBe(
      'DEMO: fix [$200]\nRepozytorium: demo/repo\nEtykiety: bounty\nUtworzono: 2026-09-01\nJęzyk (wyszukiwanie): TypeScript\n\nBody line',
    );
  });

  it('skips pull requests and items without an issue URL', () => {
    expect(mapIssue(issue({ pull_request: {} }), context)).toBe('pull_request');
    expect(mapIssue(issue({ html_url: 'https://example.invalid/x/y/issues/1' }), context)).toBe(
      'invalid',
    );
    expect(mapIssue(issue({ html_url: 'https://github.com/demo/repo/pull/7' }), context)).toBe(
      'invalid',
    );
    expect(mapIssue('nope', context)).toBe('invalid');
  });

  it('cuts the body, tolerates a null body and omits an out-of-range date', () => {
    const long = mapIssue(issue({ body: 'x'.repeat(500) }), context) as { text: string };
    expect(long.text.endsWith('x'.repeat(200))).toBe(true);
    expect(long.text).not.toContain('x'.repeat(201));
    const bare = mapIssue(issue({ body: null, created_at: '12026-01-01T00:00:00Z' }), context) as {
      text: string;
    };
    expect(bare.text).not.toContain('Utworzono');
  });

  it('gives a null reward when the issue states none or two amounts', () => {
    expect(
      (mapIssue(issue({ title: 'DEMO: fix' }), context) as { bounty: { reward: unknown } }).bounty
        .reward,
    ).toBeNull();
    const two = mapIssue(issue({ title: 'DEMO: fix', body: 'Reward: $50\nReward: $75' }), context);
    expect((two as { bounty: { reward: unknown } }).bounty.reward).toBeNull();
  });
});

describe('buildQueries (S-19 D-3, D-4)', () => {
  it('quotes labels with spaces and runs one query per language', () => {
    const config = GithubSearchConfig.parse({
      labels: ['bounty', '💎 Bounty'],
      languages: ['TypeScript', 'Jupyter Notebook'],
    });
    expect(buildQueries(config)).toEqual([
      {
        q: 'is:issue is:open archived:false label:bounty,"💎 Bounty" language:TypeScript',
        language: 'TypeScript',
      },
      {
        q: 'is:issue is:open archived:false label:bounty,"💎 Bounty" language:"Jupyter Notebook"',
        language: 'Jupyter Notebook',
      },
    ]);
  });

  it('sends one query without a language when none is configured, within 256 characters', () => {
    const config = GithubSearchConfig.parse({ labels: ['bounty'], languages: [] });
    const [only, ...rest] = buildQueries(config);
    expect(rest).toEqual([]);
    expect(only).toEqual({ q: 'is:issue is:open archived:false label:bounty', language: null });
  });

  it('keeps every query a valid config can build under the limit', () => {
    const config = GithubSearchConfig.parse({
      labels: ['bounty', 'paid', '💎 Bounty'],
      languages: ['Jupyter Notebook', 'C++'],
    });
    for (const query of buildQueries(config)) expect(query.q.length).toBeLessThanOrEqual(256);
  });

  it('encodes the path', () => {
    const path = searchPath({ q: 'a b#c', language: null });
    expect(path).toBe('/search/issues?q=a+b%23c&sort=created&order=desc&per_page=30&page=1');
  });
});

describe('limitWaitMs (S-19 D-5)', () => {
  const now = Date.UTC(2026, 9, 1);
  it('prefers retry-after, else the reset time, bounded to an hour', () => {
    expect(limitWaitMs({ 'retry-after': '30' }, now)).toBe(30_000);
    expect(limitWaitMs({ 'retry-after': '99999' }, now)).toBe(3_600_000);
    expect(limitWaitMs({ 'x-ratelimit-reset': String(now / 1000 + 120) }, now)).toBe(120_000);
    expect(limitWaitMs({ 'x-ratelimit-reset': '99999999999' }, now)).toBe(3_600_000);
    expect(limitWaitMs({ 'x-ratelimit-reset': '1' }, now)).toBe(0);
  });
  it('gives null for nothing usable', () => {
    expect(limitWaitMs({}, now)).toBeNull();
    expect(limitWaitMs({ 'x-ratelimit-reset': 'soon' }, now)).toBeNull();
  });
});
