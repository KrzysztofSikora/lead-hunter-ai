import { describe, expect, it } from 'vitest';
import { mapReward, rewardList } from './map-reward.js';

const URL = 'https://github.com/demo-org/demo-repo/issues/21';
const price = (value: unknown, unit: unknown = 'USD_CENT') => ({ value, unit });

describe('rewardList (S-19 D-15)', () => {
  it.each([
    ['an array', [{ a: 1 }]],
    ['an object with rewards', { rewards: [{ a: 1 }] }],
    ['an object with data', { data: [{ a: 1 }] }],
  ])('accepts %s', (_name, json) => {
    expect(rewardList(json)).toEqual({ ok: true, rewards: [{ a: 1 }] });
  });

  it.each([
    ['a string', 'x'],
    ['null', null],
    ['an object without a list', { rewards: {} }],
  ])('refuses %s', (_name, json) => {
    expect(rewardList(json)).toEqual({ ok: false });
  });
});

describe('mapReward (S-19 D-7, D-15)', () => {
  it('maps a USD_CENT price to integer cents with the Opire line', () => {
    expect(mapReward({ url: URL, pendingPrice: price(15_050) })).toEqual({
      ref: { owner: 'demo-org', repo: 'demo-repo', number: 21 },
      key: 'github:demo-org/demo-repo#21',
      reward: { amountMinor: 15_050, currency: 'USD', quote: '150.50 USD' },
      line: 'Nagroda (Opire): 150.50 USD',
    });
    expect(mapReward({ url: URL, pendingPrice: price(5) })?.reward?.quote).toBe('0.05 USD');
  });

  it.each([
    ['an unknown unit', price(100, 'EUR_CENT')],
    ['a fraction', price(10.5)],
    ['zero', price(0)],
    ['a negative value', price(-5)],
    ['a string value', price('150')],
    ['more than 10^11', price(100_000_000_001)],
    ['no price', undefined],
    ['a non-object price', 'USD'],
  ])('gives no reward for %s, but keeps the issue', (_name, pendingPrice) => {
    expect(mapReward({ url: URL, pendingPrice })).toMatchObject({
      key: 'github:demo-org/demo-repo#21',
      reward: null,
      line: null,
    });
  });

  it.each([
    ['not an object', 'x'],
    ['an array', []],
    ['no url', {}],
    ['a non-issue url', { url: 'https://example.com/a/b/issues/1' }],
    ['a pull request url', { url: 'https://github.com/a/b/pull/1' }],
    ['a dotted owner', { url: 'https://github.com/../b/issues/1' }],
    ['a url with a query', { url: `${URL}?x=1` }],
  ])('refuses %s', (_name, raw) => {
    expect(mapReward(raw)).toBeNull();
  });
});
