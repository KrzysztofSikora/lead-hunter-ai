import { describe, expect, it } from 'vitest';
import { parseReward } from './reward.js';

const body = (text: string) => parseReward({ labels: [], title: 'Fix the parser', body: text });
const title = (text: string) => parseReward({ labels: [], title: text, body: '' });
const label = (text: string) => parseReward({ labels: ['bug', text], title: 'x', body: '' });

describe('parseReward: stated amounts (D-7)', () => {
  it('reads a label', () => {
    expect(label('$100')).toEqual({ amountMinor: 10_000, currency: 'USD', quote: '$100' });
  });

  it('reads a reward line of the body', () => {
    expect(body('Some text\nBounty: 250 USD\nMore')).toEqual({
      amountMinor: 25_000,
      currency: 'USD',
      quote: '250 USD',
    });
  });

  it('reads a title', () => {
    expect(title('[$1,500] Add retries')).toEqual({
      amountMinor: 150_000,
      currency: 'USD',
      quote: '$1,500',
    });
  });

  it.each([
    ['€50 bounty', 5_000, 'EUR'],
    ['Bounty: EUR 50', 5_000, 'EUR'],
    ['Bounty: 1.5k USD', 150_000, 'USD'],
    ['Bounty: 2k USD', 200_000, 'USD'],
    ['Bounty: $1.5', 150, 'USD'],
    ['Bounty: US$200', 20_000, 'USD'],
    ['Nagroda: 200 zł', 20_000, 'PLN'],
    ['Nagroda: 1 000 PLN', 100_000, 'PLN'],
    ['Nagroda: 1 000,50 PLN', 100_050, 'PLN'],
    ['Nagroda: 50,50 zł', 5_050, 'PLN'],
    ['Bounty: $1000.50', 100_050, 'USD'],
  ] as const)('parses %s', (line, amountMinor, currency) => {
    expect(body(line)).toMatchObject({ amountMinor, currency });
  });

  it('accepts the same amount twice as one', () => {
    expect(body('Bounty: $100\nReward $100 USD')).toMatchObject({ amountMinor: 10_000 });
    expect(label('$100')).not.toBeNull();
    expect(parseReward({ labels: ['$100'], title: 'Pay $100', body: '' })).toMatchObject({
      amountMinor: 10_000,
    });
  });

  it('quotes exactly the matched text', () => {
    expect(body('Reward is  $ 75 for it')).toEqual({
      amountMinor: 7_500,
      currency: 'USD',
      quote: '$ 75',
    });
  });
});

describe('parseReward: edges', () => {
  it.each([
    ['Nagroda: 200zł', 20_000],
    ['Bounty: 250 USD, thanks', 25_000],
    ['Bounty: $100 USD', 10_000],
    ['Bounty: US$ 100 USD', 10_000],
    ['Bounty issue 42: $100', 10_000],
    ['Bounty: $100, see 3.5 docs', 10_000],
    ['Bounty: €, 100 USD', 10_000],
    ['Bounty: $100 for the 2-3 hour fix', 10_000],
    ['Bounty: $100 and see github.com/hello', 10_000],
    ['Bounty: $1,000,000,000', 100_000_000_000],
    ['Nagrodami są 100 zł', 10_000],
    ['Bounties: $100', 10_000],
    ['Rewards: $100', 10_000],
    ['Pay: $100', 10_000],
    ['Paid $100', 10_000],
    ['Budget $100', 10_000],
    ['Płaca: 100 zł', 10_000],
    ['Płatne 100 zł', 10_000],
  ])('%s', (line, amountMinor) => {
    expect(body(line)).toMatchObject({ amountMinor });
  });

  it('reads a short title with a foreign dollar as unknown', () => {
    expect(title('CA$200 fix')).toBeNull();
    expect(title('US$200 fix')).toMatchObject({ amountMinor: 20_000 });
  });

  it('ignores a candidate line without an amount when judging it', () => {
    expect(
      parseReward({ labels: ['sponsors welcome', 'hourly'], title: '$100 bounty', body: '' }),
    ).toMatchObject({ amountMinor: 10_000 });
  });

  it.each([
    'Bounty: $100/h',
    'Bounty: $100/hr',
    'Bounty: $100 /hour',
    'Bounty: $100/hours',
    'Bounty: $100/mo',
    'Bounty: $100/month',
    'Bounty: $100/week',
    'Bounty: $100/wk',
    'Bounty: $100/day',
    'Bounty: $100/year',
    'Bounty: $100/yr',
    'Bounty: $100/godz',
    'Bounty: $100/mies',
    'Bounty: $100 per  week',
    'Bounty: $100 per day',
    'Bounty: $100 per month',
    'Bounty: $100 per year',
    'Bounty: $100 hourly',
    'Bounty: $100 monthly',
    'Nagroda: 100 zł miesięcznie',
    'Nagroda: 100 zł godzinowo',
  ])('refuses a rate: %s', (line) => {
    expect(body(line)).toBeNull();
  });

  it.each([
    'Bounty: $100 or €100',
    'Bounty: $100 - $200',
    'Bounty: $100-$100',
    'Bounty: $100 -  100',
    'Bounty: $100 - $ 100',
    'Bounty: $100 to 200',
    'Bounty: $100 do 200',
    'Bounty: 100 USDT',
    'Bounty: $1,000,000,001',
    'Payment: $100',
    'Unpaid: $100',
  ])('refuses %s', (line) => {
    expect(body(line)).toBeNull();
  });
});

describe('parseReward: unknown stays unknown', () => {
  it.each([
    ['two different amounts', 'Bounty: $100 or $200'],
    ['another dollar', 'Bounty: CA$200'],
    ['another dollar with letters', 'Bounty: BUS$100'],
    ['an hourly rate', 'Pay: $50/hour'],
    ['a rate in words', 'Bounty $50 per hour'],
    ['a monthly amount', 'Paid $50/month'],
    ['a sponsorship', 'Bounty: Sponsor me for $5 once'],
    ['credit', 'Reward: $300 of CI credit'],
    ['a range', 'Bounty: $100–$500'],
    ['a range with a hyphen', 'Bounty: $100-500'],
    ['a zero amount', 'Bounty: $0'],
    ['a marker alone', 'Bounty: $'],
    ['a currency alone', 'Bounty: USD'],
    ['an amount on a line without a keyword', 'We have 5 users and $200 in the bank'],
    ['an ambiguous thousands dot', 'Bounty: $1.500'],
    ['more than a billion units', 'Bounty: $2,000,000,000'],
    ['mixed currencies on one number', 'Bounty: $100 EUR'],
  ])('%s', (_name, line) => {
    expect(body(line)).toBeNull();
  });

  it('does not read an amount on the line after the keyword', () => {
    expect(body('Bounty:\n$200')).toBeNull();
  });

  it('refuses when a label contradicts the body', () => {
    expect(parseReward({ labels: ['$100'], title: 'x', body: 'Bounty: $300' })).toBeNull();
  });

  it('has no reward without any amount', () => {
    expect(
      parseReward({ labels: ['bounty', 'paid'], title: 'Fix it', body: 'Please help' }),
    ).toBeNull();
  });

  it('refuses a sponsor line even when the label is clean', () => {
    expect(
      parseReward({ labels: ['$100'], title: 'x', body: 'Reward: sponsor tier $100 credit' }),
    ).toBeNull();
  });
});

describe('parseReward: cost', () => {
  it('parses a body of the import limit within a fixed budget', () => {
    const text = '$1 bounty '.repeat(2_000);
    const started = performance.now();
    expect(body(text)).toMatchObject({ amountMinor: 100 });
    const many = Array.from({ length: 2_000 }, () => 'Bounty $1').join('\n');
    expect(body(many)).toMatchObject({ amountMinor: 100 });
    expect(performance.now() - started).toBeLessThan(1_000);
  });
});

describe('parseReward: amounts that are not the reward (R1)', () => {
  it.each([
    'Support invoices over $1,000',
    '[Bounty] Fix rounding for $5 items',
    'Fix the $5 rounding bug, bounty welcome',
    'Fix the $10 paid tier checkout',
    'Wrong price shown ($10)',
    'DEMO[$200] fix it',
    '[DEMO$200] fix it',
  ])('title %s is unknown', (text) => {
    expect(title(text)).toBeNull();
  });

  it.each([
    'The paid plan costs $10',
    'We pay $5 per test case',
    'Bounty: $200 AUD',
    'Bounty: 200 USDC',
    'Bounty $: 50',
    'The $10 paid plan is broken',
    'Users on the $20 budget tier',
    'Bounty: $200 USDC',
    'Bounty: $200 USDT',
    'Bounty: $200 aud',
    'Bounty: $200 (AUD)',
    'Bounty: $200AUD',
    '$5 fee applies to this bounty',
  ])('body %s is unknown', (line) => {
    expect(body(line)).toBeNull();
  });

  it.each([
    'Bounty: $50 paid after merge',
    'This issue has a $50 bounty',
    'Bounty: $50 EXTRAS',
    'Bounty: $50 for the fix',
  ])('body %s is the reward', (line) => {
    expect(body(line)).toMatchObject({ amountMinor: 5_000, currency: 'USD' });
  });

  it('refuses the same amount in two currencies', () => {
    expect(parseReward({ labels: ['$50'], title: 'x', body: 'Bounty: €50' })).toBeNull();
  });

  it('keeps a label reward next to a price in the title', () => {
    expect(
      parseReward({ labels: ['💎 Bounty $50'], title: 'Fix the $5 rounding', body: '' }),
    ).toMatchObject({ amountMinor: 5_000 });
  });

  it('ignores a body line without a reward word beside a reward line', () => {
    expect(body('Bounty: $50\nCosts $5 to run')).toMatchObject({ amountMinor: 5_000 });
  });

  it.each(['[$200] Fix it', '($200) Fix it', '$200 Fix it', 'Bounty: $200 Fix it'])(
    'title %s is the reward',
    (text) => {
      expect(title(text)).toMatchObject({ amountMinor: 20_000 });
    },
  );
});
