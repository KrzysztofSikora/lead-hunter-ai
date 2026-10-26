import type { Currency } from '@lead-hunter/contracts';

/** S-19 D-7: the reward an issue states about itself; `null` means unknown, never a guess. */
export interface ParsedReward {
  amountMinor: number;
  currency: Currency;
  quote: string;
}

export interface RewardInput {
  labels: readonly string[];
  title: string;
  body: string;
}

const MAX_MAJOR_UNITS = 1_000_000_000;

const KEYWORD =
  /(?<![\p{L}\p{N}])(?:bount(?:y|ies)|rewards?|nagrod\p{L}*|pay|paid|budget|płac\p{L}*|płatn\p{L}*)(?![\p{L}\p{N}])/iu;
const RATE =
  /\/\s?(?:h|hr|hour|hours|mo|month|week|wk|day|year|yr|godz|mies)(?![\p{L}\p{N}])|per\s+(?:hour|month|week|day|year)|hourly|monthly|miesięcznie|godzinowo/iu;
const NOT_A_REWARD = /sponsor|credit/iu;

const NUMBER = String.raw`\d{1,3}(?:[ ,]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?`;
const TOKEN = new RegExp(String.raw`(?<![\d.,])(${NUMBER})(?!\d)(k(?![\p{L}\p{N}]))?`, 'gu');
const MARKER_BEFORE = /(US\$|\$|€|USD|EUR|PLN)\s?$/iu;
const MARKER_AFTER = /^(\s?)(USD|EUR|PLN|zł|\$|€)(?![\p{L}])/iu;

const CURRENCY: Record<string, Currency> = {
  us$: 'USD',
  $: 'USD',
  usd: 'USD',
  '€': 'EUR',
  eur: 'EUR',
  pln: 'PLN',
  zł: 'PLN',
};

/** A `$` that follows letters other than `US` is another dollar (`CA$`, `AU$`). */
function hasForeignDollar(line: string): boolean {
  for (let at = line.indexOf('$'); at >= 0; at = line.indexOf('$', at + 1)) {
    const letters = /\p{L}+$/u.exec(line.slice(Math.max(0, at - 6), at))?.[0];
    if (letters !== undefined && letters.toLowerCase() !== 'us') return true;
  }
  return false;
}

/** Major units of `token`: a separator followed by one or two digits is the decimal point. */
function majorUnits(token: string): number {
  const decimal = /^(.*?)[.,](\d{1,2})$/u.exec(token);
  if (decimal) return Number(`${decimal[1]!.replace(/\D/g, '')}.${decimal[2]}`);
  return Number(token.replace(/\D/g, ''));
}

/** `null` stands for a refusal of the whole parse, `[]` for a line without an amount. */
function amountsIn(line: string): ParsedReward[] | null {
  if (hasForeignDollar(line)) return null;
  const found: ParsedReward[] = [];
  for (const match of line.matchAll(TOKEN)) {
    const start = match.index;
    const token = match[1]!;
    let end = start + match[0].length;
    const before = MARKER_BEFORE.exec(line.slice(Math.max(0, start - 4), start));
    const after = MARKER_AFTER.exec(line.slice(end, end + 6));
    if (!before && !after) continue;
    if (/^[.,]\d/u.test(line.slice(end))) return null;
    const marker = before?.[1] ?? after![2]!;
    const second = before && after ? after[2]!.toLowerCase() : null;
    if (second !== null && CURRENCY[second] !== CURRENCY[marker.toLowerCase()]) return null;
    const from = before ? start - before[0].length : start;
    if (after) end += after[0].length;
    if (/^\s*(?:[-–—]|to\b|do\b)\s*[$€]?\s?\d/iu.test(line.slice(end))) return null;
    const major = majorUnits(token) * (match[2] ? 1000 : 1);
    const quote = line.slice(from, end).trim();
    if (!(major > 0) || major > MAX_MAJOR_UNITS) return null;
    found.push({
      amountMinor: Math.round(major * 100),
      currency: CURRENCY[marker.toLowerCase()]!,
      quote,
    });
  }
  return found;
}

/**
 * Candidates, in order: labels, the title, then body lines that name a reward. Exactly one
 * distinct amount and currency gives a reward; anything ambiguous gives `null`.
 */
export function parseReward({ labels, title, body }: RewardInput): ParsedReward | null {
  const lines = [...labels, title, ...body.split(/\r?\n/u).filter((line) => KEYWORD.test(line))];
  let first: ParsedReward | null = null;
  for (const line of lines) {
    const amounts = amountsIn(line);
    if (amounts === null) return null;
    if (amounts.length === 0) continue;
    if (RATE.test(line) || NOT_A_REWARD.test(line)) return null;
    for (const amount of amounts) {
      if (first === null) first = amount;
      else if (first.amountMinor !== amount.amountMinor || first.currency !== amount.currency) {
        return null;
      }
    }
  }
  return first;
}
