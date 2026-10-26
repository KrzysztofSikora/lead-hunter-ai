import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { Source, SourceFilter, UpdateSourceRequest } from './sources.js';

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
