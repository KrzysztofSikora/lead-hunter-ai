import { describe, expect, it } from 'vitest';
import { mapReward, rewardList } from './map-reward.js';

const reward = (over: object = {}) => ({
  url: 'https://github.com/demo-org/demo-api/issues/31',
  pendingPrice: { value: 15_000, unit: 'USD_CENT' },
  ...over,
});

describe('rewardList (S-19 D-15)', () => {
  it('takes an array, or an array under rewards or data', () => {
    expect(rewardList([1])).toEqual([1]);
    expect(rewardList({ rewards: [2] })).toEqual([2]);
    expect(rewardList({ data: [3] })).toEqual([3]);
  });
  it('refuses any other shape', () => {
    for (const json of [null, 'x', 7, {}, { rewards: 'x' }]) expect(rewardList(json)).toBeNull();
  });
});

describe('mapReward (S-19 D-7, D-15)', () => {
  it('reads the issue and a USD_CENT amount with the Opire line as quote', () => {
    expect(mapReward(reward())).toEqual({
      owner: 'demo-org',
      repo: 'demo-api',
      issueNumber: 31,
      key: 'github:demo-org/demo-api#31',
      reward: { amountMinor: 15_000, currency: 'USD', quote: 'Nagroda (Opire): 150.00 USD' },
      line: 'Nagroda (Opire): 150.00 USD',
    });
  });

  it('pads the cents', () => {
    const mapped = mapReward(reward({ pendingPrice: { value: 10_005, unit: 'USD_CENT' } }));
    expect(mapped).toMatchObject({ line: 'Nagroda (Opire): 100.05 USD' });
  });

  it('keeps an unknown unit or a bad amount as no reward, never a guess', () => {
    for (const pendingPrice of [
      { value: 15_000, unit: 'EUR_CENT' },
      { value: 15_000 },
      { value: 0, unit: 'USD_CENT' },
      { value: -5, unit: 'USD_CENT' },
      { value: 1.5, unit: 'USD_CENT' },
      { value: 1e15, unit: 'USD_CENT' },
      null,
    ]) {
      expect(mapReward(reward({ pendingPrice }))).toMatchObject({ reward: null, line: null });
    }
    expect(mapReward({ url: reward().url })).toMatchObject({ reward: null });
  });

  it('refuses a URL that is not a GitHub issue', () => {
    for (const url of [
      'https://example.com/a/b/issues/1',
      'https://github.com/a/b/pull/1',
      'https://github.com/a/b/issues/0',
      'https://github.com/a/b/issues/1/',
      'https://github.com/../user/issues/1',
      'https://github.com/a/../issues/1',
      'https://github.com/a/./issues/1',
      'https://github.com/%2e%2e/b/issues/1',
      'https://github.com/a?x=/b/issues/1',
      'https://github.com/a/b?/issues/1',
      'https://github.com/a/b#/issues/1',
      'not a url',
    ]) {
      expect(mapReward(reward({ url }))).toBe('invalid');
    }
    expect(mapReward(null)).toBe('invalid');
    expect(mapReward({ pendingPrice: {} })).toBe('invalid');
  });
});
