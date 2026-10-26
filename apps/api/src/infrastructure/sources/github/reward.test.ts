import { describe, expect, it } from 'vitest';
import { parseReward } from './reward.js';

const parse = (over: { labels?: string[]; title?: string; body?: string }) =>
  parseReward({ labels: [], title: 'DEMO issue', body: '', ...over });

describe('parseReward (S-19 D-7)', () => {
  it.each([
    ['a dollar label', { labels: ['bounty', '$100'] }, 10_000, 'USD', '$100'],
    ['a title tag', { title: 'Fix the parser [$1,500]' }, 150_000, 'USD', '$1,500'],
    [
      'a body line with a keyword',
      { body: 'Intro\nBounty: 250 USD\nOutro' },
      25_000,
      'USD',
      '250 USD',
    ],
    ['euros', { labels: ['€50'] }, 5_000, 'EUR', '€50'],
    ['a k suffix', { body: 'Reward: 1k USD' }, 100_000, 'USD', '1k USD'],
    ['zloty after the number', { body: 'Nagroda: 500 zł' }, 50_000, 'PLN', '500 zł'],
    ['a space as thousands separator', { body: 'bounty $1 000' }, 100_000, 'USD', '$1 000'],
    ['a decimal tail', { body: 'Bounty: $12.50' }, 1_250, 'USD', '$12.50'],
    ['US$', { body: 'reward US$75' }, 7_500, 'USD', 'US$75'],
    ['a k suffix on a fraction', { body: 'Reward: 1.5k USD' }, 150_000, 'USD', '1.5k USD'],
    ['a one-digit fraction', { body: 'Bounty: $1.5' }, 150, 'USD', '$1.5'],
    ['a word marker for euros', { body: 'Reward: EUR 40' }, 4_000, 'EUR', 'EUR 40'],
    ['a euro word after the number', { labels: ['40 EUR'] }, 4_000, 'EUR', '40 EUR'],
    ['US$ at the start of the text', { labels: ['US$20'] }, 2_000, 'USD', 'US$20'],
    ['a euro sign right after a letter', { labels: ['x€5'] }, 500, 'EUR', '€5'],
    ['a CRLF body', { body: 'Intro\r\nBounty: 250 USD\r\nOutro' }, 25_000, 'USD', '250 USD'],
    ['the largest amount', { labels: ['$1000000000'] }, 100_000_000_000, 'USD', '$1000000000'],
    [
      'a quote of the longest length',
      { labels: [`$${'0'.repeat(58)}1`] },
      100,
      'USD',
      `$${'0'.repeat(58)}1`,
    ],
    ['a keyword in an inflected word', { body: 'Nagrodzie: 70 USD' }, 7_000, 'USD', '70 USD'],
    ['a Polish verb', { body: 'Płacimy 30 USD' }, 3_000, 'USD', '30 USD'],
    ['a Polish adjective', { body: 'Płatnych: 20 USD' }, 2_000, 'USD', '20 USD'],
    ['a pay line', { body: 'Will pay $300 for a fix' }, 30_000, 'USD', '$300'],
    ['a budget line', { body: 'Budget: 2000 PLN' }, 200_000, 'PLN', '2000 PLN'],
  ])('reads %s', (_name, input, amountMinor, currency, quote) => {
    expect(parse(input)).toEqual({ amountMinor, currency, quote });
  });

  it('takes the same amount stated twice as one reward', () => {
    expect(parse({ labels: ['$200'], title: '[$200] Fix it', body: 'Bounty: 200 USD' })).toEqual({
      amountMinor: 20_000,
      currency: 'USD',
      quote: '$200',
    });
  });

  it.each([
    ['two different amounts', { labels: ['$100'], title: '[$200] Fix it' }],
    ['an amount on a line without a keyword', { body: 'We have 300 USD of CI credit.' }],
    ['a currency sign alone', { labels: ['$'], body: 'Bounty: $' }],
    ['a currency of an unknown kind', { labels: ['CA$200'] }],
    ['an unknown currency next to a known one', { labels: ['$100'], title: 'AU$100' }],
    [
      'an amount line next to a keyword-free one',
      { body: 'Bounty below\nWe have 300 USD of CI credit.' },
    ],
    ['a letter before US$', { labels: ['BUS$100'] }],
    ['a letter and a digit before US$', { labels: ['A1US$100'] }],
    ['an amount just over the contract', { labels: ['$1000000000.01'] }],
    ['a quote over the length limit', { labels: [`$${'1'.repeat(59)}`] }],
    ['a zero amount', { labels: ['$0'] }],
    ['an amount beyond the contract', { labels: ['$99999999999'] }],
    ['a quote that is a run of zeros', { labels: [`$${'0'.repeat(80)}1`] }],
    ['no amount', { labels: ['💎 Bounty'], body: 'Bounty available.' }],
    ['a number inside a longer number', { body: 'Bounty: 1234567 USDT' }],
  ])('gives null for %s', (_name, input) => {
    expect(parse(input)).toBeNull();
  });

  it('ends within a fixed time on a maximum-size body of amounts', () => {
    const body = 'bounty ' + '$1 $2 '.repeat(3_400);
    const started = performance.now();
    expect(parse({ body })).toBeNull();
    expect(performance.now() - started).toBeLessThan(1_000);
  });

  it('ends within a fixed time on long runs of digits and separators', () => {
    const started = performance.now();
    parse({ body: `bounty ${'1,'.repeat(10_000)} USD\nreward ${'9 '.repeat(10_000)}$` });
    parse({ body: `bounty ${'US'.repeat(10_000)}` });
    expect(performance.now() - started).toBeLessThan(1_000);
  });

  it('cuts the body at the text limit before scanning', () => {
    const body = `${'x'.repeat(20_000)}\nBounty: $5`;
    expect(parse({ body })).toBeNull();
  });
});
