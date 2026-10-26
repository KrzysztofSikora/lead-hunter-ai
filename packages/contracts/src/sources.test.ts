import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { TenderFacts } from './opportunities.js';
import { BzpConfig, Source, SourceFilter, TedConfig, UpdateSourceRequest } from './sources.js';

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
      presetWithdrawn: false,
      lastAttemptAt: null,
      lastSuccessAt: null,
      tender: null,
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

  it('takes a tender config alone (S-18 D-7)', () => {
    expect(
      UpdateSourceRequest.safeParse({ tender: { cpvPrefixes: ['72'], countries: ['PL'] } }).success,
    ).toBe(true);
    expect(UpdateSourceRequest.safeParse({ tender: { cpvPrefixes: [] } }).success).toBe(false);
  });
});

describe('tender config (S-18 D-7)', () => {
  it.each<[string, unknown]>([
    ['a one-digit prefix', ['7']],
    ['a nine-digit prefix', ['123456789']],
    ['a non-digit prefix', ['72a']],
    ['a duplicate', ['72', '72']],
    ['no prefix', []],
    ['21 prefixes', Array.from({ length: 21 }, (_, n) => String(10 + n))],
  ])('rejects %s', (_name, cpvPrefixes) => {
    expect(BzpConfig.safeParse({ cpvPrefixes }).success).toBe(false);
  });

  it('accepts 2 to 8 digits and 20 prefixes', () => {
    expect(BzpConfig.safeParse({ cpvPrefixes: ['72', '48000000', '7322'] }).success).toBe(true);
    const twenty = Array.from({ length: 20 }, (_, n) => String(10 + n));
    expect(BzpConfig.safeParse({ cpvPrefixes: twenty }).success).toBe(true);
  });

  it('rejects an unknown key, and bad or missing TED countries', () => {
    expect(BzpConfig.safeParse({ cpvPrefixes: ['72'], countries: ['PL'] }).success).toBe(false);
    expect(TedConfig.safeParse({ cpvPrefixes: ['72'] }).success).toBe(false);
    expect(TedConfig.safeParse({ cpvPrefixes: ['72'], countries: ['pl'] }).success).toBe(false);
    expect(TedConfig.safeParse({ cpvPrefixes: ['72'], countries: ['PL', 'PL'] }).success).toBe(
      false,
    );
    expect(TedConfig.safeParse({ cpvPrefixes: ['72'], countries: [] }).success).toBe(false);
    expect(TedConfig.safeParse({ cpvPrefixes: ['72'], countries: ['PL', 'DE'] }).success).toBe(
      true,
    );
  });
});

describe('TenderFacts (S-18 D-2)', () => {
  const facts = {
    noticeId: '2026/BZP 00123456',
    buyer: 'DEMO Urząd Miasta',
    deadlineAt: '2026-11-20T10:00:00.000Z',
    estimatedValue: {
      amountMinor: 12_300_000,
      currency: 'PLN',
      quote: 'Wartość szacunkowa: 123000 PLN',
    },
    cpvCodes: ['72200000-7', '48000000'],
    procedure: 'Przetarg nieograniczony',
    country: 'PL',
  };

  it('accepts complete and empty facts', () => {
    expect(TenderFacts.safeParse(facts).success).toBe(true);
    expect(
      TenderFacts.safeParse({
        ...facts,
        buyer: null,
        deadlineAt: null,
        estimatedValue: null,
        cpvCodes: [],
        procedure: null,
        country: null,
      }).success,
    ).toBe(true);
  });

  it.each<[string, object]>([
    ['an empty notice id', { noticeId: '' }],
    ['a 301-character buyer', { buyer: 'x'.repeat(301) }],
    ['a deadline that is not an instant', { deadlineAt: '20.11.2026' }],
    ['a negative value', { estimatedValue: { amountMinor: -1, currency: 'PLN', quote: 'q' } }],
    ['a fractional value', { estimatedValue: { amountMinor: 1.5, currency: 'PLN', quote: 'q' } }],
    [
      'a currency outside the profile',
      { estimatedValue: { amountMinor: 1, currency: 'GBP', quote: 'q' } },
    ],
    ['a malformed CPV code', { cpvCodes: ['7220'] }],
    ['21 CPV codes', { cpvCodes: Array.from({ length: 21 }, () => '72000000') }],
    ['a lower-case country', { country: 'pl' }],
    ['an unknown key', { extra: 1 }],
  ])('rejects %s', (_name, over) => {
    expect(TenderFacts.safeParse({ ...facts, ...over }).success).toBe(false);
  });
});
