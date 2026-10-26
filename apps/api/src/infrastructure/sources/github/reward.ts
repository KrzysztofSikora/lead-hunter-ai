import { DEFAULT_IMPORT_MAX_TEXT_CHARS, type BountyFacts } from '@lead-hunter/contracts';

export type Reward = NonNullable<BountyFacts['reward']>;

export interface RewardSource {
  labels: readonly string[];
  title: string;
  body: string;
}

const MAX_MINOR = 100_000_000_000;
const MAX_QUOTE = 60;

const LETTER_OR_DIGIT = '[\\p{L}\\p{N}]';

/** `1,500`, `1 000`, `1.500,50`, `1000.50`, `250`; thousands groups are exactly three digits. */
const NUMBER =
  '(?:(?<t>\\d{1,3}(?:[,. ]\\d{3})+)(?:[.,](?<tf>\\d{1,2}))?|(?<i>\\d+)(?:[.,](?<f>\\d{1,2}))?)' +
  '(?<k>k(?![\\p{L}\\p{N}]))?(?!\\d)';

/** `$100`, `€50`, `USD 100`, `US$100`; a word marker needs a word boundary before it. */
const PREFIXED = new RegExp(
  `(?<m>\\$|€|(?<!${LETTER_OR_DIGIT})(?:USD|EUR|PLN))\\s?${NUMBER}`,
  'giu',
);
/** `250 USD`, `1k USD`, `50 zł`, `100$`. */
const SUFFIXED = new RegExp(
  `(?<!${LETTER_OR_DIGIT})(?<!\\d[.,])${NUMBER}\\s?(?<m>zł|USD|EUR|PLN|\\$|€)(?!${LETTER_OR_DIGIT})`,
  'giu',
);

/** A body line is a candidate only when it talks about a reward. */
const KEYWORD =
  /(?<![\p{L}\p{N}])(?:bounty|bounties|rewards?|nagrod\p{L}*|pay|paid|budget|płac\p{L}*|płatn\p{L}*)(?![\p{L}\p{N}])/iu;

const CURRENCY_OF: Record<string, Reward['currency']> = {
  $: 'USD',
  usd: 'USD',
  '€': 'EUR',
  eur: 'EUR',
  zł: 'PLN',
  pln: 'PLN',
};

type Found = { key: string; reward: Reward } | 'refused';

/** The minor units of a matched number, or null when it is zero or out of range. */
function minorOf(groups: Record<string, string | undefined>): number | null {
  const whole = groups.t ?? groups.i ?? '';
  const fraction = groups.tf ?? groups.f;
  let units = Number(whole.replace(/\D/g, ''));
  let minor = fraction === undefined ? 0 : Number(fraction.padEnd(2, '0'));
  if (groups.k !== undefined) {
    units *= 1000;
    minor *= 1000;
  }
  const total = units * 100 + minor;
  return Number.isSafeInteger(total) && total > 0 && total <= MAX_MINOR ? total : null;
}

function amountsIn(text: string): Found[] {
  const found: Found[] = [];
  for (const [pattern, prefixed] of [
    [PREFIXED, true],
    [SUFFIXED, false],
  ] as const) {
    for (const match of text.matchAll(pattern)) {
      const marker = match.groups!.m!;
      let start = match.index!;
      let currency = CURRENCY_OF[marker.toLowerCase()]!;
      if (prefixed && marker === '$' && start > 0 && /\p{L}/u.test(text[start - 1]!)) {
        // `US$` is dollars; `CA$`, `AU$` and the like are a currency this parser does not know.
        const us = /^us$/i.test(text.slice(start - 2, start));
        if (us && !(start > 2 && /[\p{L}\p{N}]/u.test(text[start - 3]!))) {
          start -= 2;
          currency = 'USD';
        } else {
          found.push('refused');
          continue;
        }
      }
      const minor = minorOf(match.groups!);
      const quote = text.slice(start, match.index! + match[0].length).trim();
      if (minor === null || quote.length > MAX_QUOTE) {
        found.push('refused');
        continue;
      }
      found.push({
        key: `${currency}:${minor}`,
        reward: { amountMinor: minor, currency, quote },
      });
    }
  }
  return found;
}

/**
 * D-7: the reward an issue states, read by rules and never guessed. Labels and the title are
 * candidates as they are; a body line only when it names a reward. Exactly one distinct amount
 * gives a reward with the verbatim text it was read from; none, several, or an amount in an
 * unknown currency or out of range gives `null`.
 */
export function parseReward(source: RewardSource): Reward | null {
  const body = source.body.slice(0, DEFAULT_IMPORT_MAX_TEXT_CHARS);
  const candidates = [
    ...source.labels,
    source.title,
    ...body.split(/\r?\n/).filter((line) => KEYWORD.test(line)),
  ];
  const distinct = new Map<string, Reward>();
  for (const candidate of candidates) {
    for (const found of amountsIn(candidate)) {
      if (found === 'refused') return null;
      if (!distinct.has(found.key)) distinct.set(found.key, found.reward);
      if (distinct.size > 1) return null;
    }
  }
  return distinct.size === 1 ? [...distinct.values()][0]! : null;
}
