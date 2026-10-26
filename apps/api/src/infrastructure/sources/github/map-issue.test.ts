import { BountyFacts } from '@lead-hunter/contracts';
import { describe, expect, it } from 'vitest';
import { mapIssue } from './map-issue.js';

const raw = (over: Record<string, unknown> = {}) => ({
  html_url: 'https://github.com/demo-org/demo-repo/issues/7',
  number: 7,
  title: 'DEMO parser crashes',
  body: 'Details here.',
  labels: [{ name: 'bounty' }, { name: '$150' }],
  state: 'open',
  created_at: '2026-10-20T10:00:00Z',
  ...over,
});

function item(input: unknown, language: string | null = 'TypeScript', max = 20_000) {
  const mapped = mapIssue(input, language, max);
  if (mapped.kind !== 'item') throw new Error(`expected an item, got ${mapped.kind}`);
  return mapped.item;
}

describe('mapIssue', () => {
  it('maps the labelled lines, the key, the url and valid facts (D-6)', () => {
    const mapped = item(raw());
    expect(mapped).toMatchObject({
      key: 'github:demo-org/demo-repo#7',
      url: 'https://github.com/demo-org/demo-repo/issues/7',
      title: 'DEMO parser crashes',
      publishedAt: null,
    });
    expect(mapped.text).toBe(
      [
        'DEMO parser crashes',
        'Repozytorium: demo-org/demo-repo',
        'Etykiety: bounty, $150',
        'Język (wyszukiwanie): TypeScript',
        'Utworzono: 2026-10-20',
        '',
        'Details here.',
      ].join('\n'),
    );
    expect(mapped.bounty).toEqual({
      platform: 'github',
      repository: 'demo-org/demo-repo',
      issueNumber: 7,
      labels: ['bounty', '$150'],
      reward: { amountMinor: 15_000, currency: 'USD', quote: '$150' },
    });
    expect(BountyFacts.safeParse(mapped.bounty).success).toBe(true);
  });

  it('leaves the reward null when the issue states none', () => {
    expect(item(raw({ labels: [{ name: 'bounty' }] })).bounty?.reward).toBeNull();
  });

  it('skips a pull request and an unreadable item', () => {
    expect(mapIssue(raw({ pull_request: { url: 'x' } }), null, 100)).toEqual({ kind: 'ignored' });
    for (const bad of [
      null,
      'x',
      [],
      raw({ html_url: 'https://github.com/a/../issues/1' }),
      raw({ title: ' ' }),
    ]) {
      expect(mapIssue(bad, null, 100)).toEqual({ kind: 'invalid' });
    }
  });

  it('leaves out an out-of-range or unreadable date and the language line when none', () => {
    for (const created_at of ['1999-12-31T00:00:00Z', '2100-01-01T00:00:00Z', 'nonsense', 5]) {
      expect(item(raw({ created_at }), null).text).not.toContain('Utworzono');
    }
    expect(item(raw(), null).text).not.toContain('Język');
  });

  it('cuts the body at the limit and caps the labels', () => {
    const mapped = item(
      raw({
        body: 'x'.repeat(500),
        labels: Array.from({ length: 30 }, (_, n) => ({ name: `l${n}` })),
      }),
      'Go',
      100,
    );
    expect(mapped.text.endsWith('x'.repeat(100))).toBe(true);
    expect(mapped.text).not.toContain('x'.repeat(101));
    expect(mapped.bounty?.labels).toHaveLength(20);
  });
});
