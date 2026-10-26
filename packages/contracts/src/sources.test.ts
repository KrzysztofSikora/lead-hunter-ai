import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { BountyFacts } from './opportunities.js';
import { GithubSearchConfig, Source, SourceFilter, UpdateSourceRequest } from './sources.js';

const filter = (over: object) => ({ enabled: true, include: [], exclude: [], ...over });

describe('SourceFilter (S-17 D-2, D-16)', () => {
  it.each<[string, object]>([
    ['a case-insensitive duplicate', { include: ['React', 'react'] }],
    ['a 101-character phrase', { exclude: ['x'.repeat(101)] }],
    ['31 phrases', { include: Array.from({ length: 31 }, (_, n) => `p${n}`) }],
    ['a blank phrase', { exclude: ['   '] }],
    ['an unknown key', { extra: 1 }],
  ])('rejects %s', (_name, over) => {
    expect(SourceFilter.safeParse(filter(over)).success).toBe(false);
  });

  it('trims accepted phrases and accepts 30 of 100 characters', () => {
    expect(SourceFilter.parse(filter({ include: ['  react  '] })).include).toEqual(['react']);
    const full = Array.from({ length: 30 }, (_, n) => `${n}`.padEnd(100, 'x'));
    expect(SourceFilter.safeParse(filter({ exclude: full })).success).toBe(true);
  });

  it('encodes inside Source, which response schemas need (no transform)', () => {
    const source = {
      id: 1,
      type: 'rss' as const,
      name: 'DEMO',
      url: 'https://feeds.example/x.xml',
      presetId: null,
      accessNote: 'x',
      termsUrl: null,
      enabled: true,
      filter: filter({ include: ['react'] }),
      github: null,
      presetWithdrawn: false,
      lastAttemptAt: null,
      lastSuccessAt: null,
      lastError: null,
      nextAllowedAt: null,
    };
    expect(() => z.encode(Source, source)).not.toThrow();
  });
});

describe('UpdateSourceRequest (S-17 D-13)', () => {
  it('takes enabled, filter or both, and nothing else', () => {
    expect(UpdateSourceRequest.safeParse({ enabled: false }).success).toBe(true);
    expect(UpdateSourceRequest.safeParse({ filter: filter({}) }).success).toBe(true);
    expect(UpdateSourceRequest.safeParse({}).success).toBe(false);
    expect(UpdateSourceRequest.safeParse({ enabled: true, x: 1 }).success).toBe(false);
  });
});

describe('GithubSearchConfig (S-19 D-3)', () => {
  const ok = { labels: ['bounty', '💎 Bounty'], languages: ['TypeScript'] };

  it('accepts labels with a space and an empty language list', () => {
    expect(GithubSearchConfig.safeParse(ok).success).toBe(true);
    expect(GithubSearchConfig.safeParse({ ...ok, languages: [] }).success).toBe(true);
  });

  it.each<[string, object]>([
    ['no labels', { labels: [] }],
    ['11 labels', { labels: Array.from({ length: 11 }, (_, n) => `l${n}`) }],
    ['a 51-character label', { labels: ['x'.repeat(51)] }],
    ['a quote in a label', { labels: ['a"b'] }],
    ['a case-insensitive duplicate label', { labels: ['Bounty', 'bounty'] }],
    ['a language outside the list', { languages: ['Brainfuck'] }],
    ['a duplicate language', { languages: ['Go', 'Go'] }],
    ['6 languages', { languages: ['Go', 'Rust', 'Java', 'Dart', 'Lua', 'Zig'] }],
    ['an unknown key', { q: 'is:pr' }],
    [
      'a query over 256 characters',
      { labels: Array.from({ length: 6 }, (_, n) => `${n}`.padEnd(45, 'x')) },
    ],
  ])('rejects %s', (_name, over) => {
    expect(GithubSearchConfig.safeParse({ ...ok, ...over }).success).toBe(false);
  });

  it('is accepted by PATCH on its own', () => {
    expect(UpdateSourceRequest.safeParse({ github: ok }).success).toBe(true);
  });
});

describe('BountyFacts (S-19 D-2)', () => {
  const facts = {
    platform: 'github',
    repository: 'demo/repo',
    issueNumber: 7,
    labels: ['bounty'],
    reward: { amountMinor: 10_000, currency: 'USD', quote: '$100' },
  };

  it('accepts a stated reward and none', () => {
    expect(BountyFacts.safeParse(facts).success).toBe(true);
    expect(BountyFacts.safeParse({ ...facts, reward: null }).success).toBe(true);
  });

  it.each<[string, object]>([
    ['a negative amount', { reward: { ...facts.reward, amountMinor: -1 } }],
    ['a fractional amount', { reward: { ...facts.reward, amountMinor: 1.5 } }],
    ['an amount over the bound', { reward: { ...facts.reward, amountMinor: 100_000_000_001 } }],
    ['an unknown currency', { reward: { ...facts.reward, currency: 'XXX' } }],
    ['an empty quote', { reward: { ...facts.reward, quote: '' } }],
    ['issue number 0', { issueNumber: 0 }],
    ['21 labels', { labels: Array.from({ length: 21 }, (_, n) => `l${n}`) }],
    ['a 141-character repository', { repository: 'x'.repeat(141) }],
    ['an unknown platform', { platform: 'gitlab' }],
  ])('rejects %s', (_name, over) => {
    expect(BountyFacts.safeParse({ ...facts, ...over }).success).toBe(false);
  });
});
