import type { BountyFacts, OpportunityAnalysis, SourceType } from '@lead-hunter/contracts';
import { hasHiringCue } from './cues.js';

export interface GuardedAnalysis {
  result: OpportunityAnalysis;
  notes: string[];
}

const squash = (value: string): string => value.replace(/\s+/g, ' ').trim().toLowerCase();

/** What the source adapter stated about a signal, outside the text (S-19 D-10). */
export interface GuardOrigin {
  sourceType: SourceType;
  bounty: BountyFacts | null;
}

const isBountySource = (origin: GuardOrigin | undefined): origin is GuardOrigin =>
  origin?.sourceType === 'github' || origin?.sourceType === 'opire';

const PAID_CATEGORIES = new Set(['DIRECT_GIG', 'B2B_SUBCONTRACT']);

/** Amounts (minor units) a number in the text can mean: separators as thousands, or a decimal tail. */
function amountsIn(text: string): Set<number> {
  const amounts = new Set<number>();
  for (const token of text.match(/\d[\d .,]*\d|\d/g) ?? []) {
    amounts.add(Number(token.replace(/\D/g, '')) * 100);
    const decimal = /^(.*\d)[.,](\d{1,2})$/.exec(token);
    if (decimal) {
      const cents = decimal[2]!.padEnd(2, '0');
      amounts.add(Number(decimal[1]!.replace(/\D/g, '')) * 100 + Number(cents));
    }
  }
  return amounts;
}

const CURRENCY_TOKEN = /(?<!\p{L})(PLN|zł|EUR|€|USD|\$)(?!\p{L})/giu;
const CURRENCY_OF: Record<string, string> = {
  pln: 'PLN',
  zł: 'PLN',
  eur: 'EUR',
  '€': 'EUR',
  usd: 'USD',
  $: 'USD',
};

/** The quote must be spelled with the budget's currency, and only with it. */
function quoteCurrencyMatches(quote: string, currency: string): boolean {
  const tokens = [...quote.matchAll(CURRENCY_TOKEN)].map((m) => CURRENCY_OF[m[1]!.toLowerCase()]);
  return tokens.length > 0 && tokens.every((token) => token === currency);
}

/** True when some occurrence of the quote starts and ends outside a longer number in the text. */
function quoteIsWholeNumber(haystack: string, quote: string): boolean {
  const needle = squash(quote);
  const first = needle.search(/\d/);
  const last = needle.search(/\d(?!.*\d)/);
  if (first < 0) return false;
  for (let at = haystack.indexOf(needle); at >= 0; at = haystack.indexOf(needle, at + 1)) {
    const before = haystack.slice(0, at + first);
    const after = haystack.slice(at + last + 1);
    if (!/\d[ .,]?$/.test(before) && !/^[ .,]?\d/.test(after)) return true;
  }
  return false;
}

/** The quote is the evidence for the amounts: both must be readable in it. */
function quoteStates(budget: { minMinor: number; maxMinor: number; quote: string }): boolean {
  const amounts = amountsIn(budget.quote);
  return amounts.has(budget.minMinor) && amounts.has(budget.maxMinor);
}

/**
 * D-14: provider-independent checks after schema validation. What the source did not say is
 * removed or downgraded, and every change is noted. Source text is only compared, never executed.
 */
function guardAgainstSource(
  result: OpportunityAnalysis,
  sourceText: string,
  origin?: GuardOrigin,
): GuardedAnalysis {
  const notes: string[] = [];
  const haystack = squash(sourceText);
  const inSource = (value: string): boolean => {
    const needle = squash(value);
    return needle !== '' && haystack.includes(needle);
  };

  const sourceFacts = result.sourceFacts.filter((fact) => {
    if (inSource(fact)) return true;
    notes.push(`Usunięto fakt „ze źródła”, którego nie ma w tekście: „${fact.slice(0, 80)}”.`);
    return false;
  });

  if (result.verdict === 'INSUFFICIENT_DATA') {
    return { result: { ...result, sourceFacts }, notes };
  }

  let sourceBudget = result.sourceBudget;
  if (sourceBudget && !inSource(sourceBudget.quote)) {
    notes.push('Usunięto budżet ze źródła: cytat nie występuje w tekście.');
    sourceBudget = null;
  } else if (sourceBudget && !quoteStates(sourceBudget)) {
    notes.push('Usunięto budżet ze źródła: cytat nie zawiera podanych kwot.');
    sourceBudget = null;
  } else if (sourceBudget && !quoteCurrencyMatches(sourceBudget.quote, sourceBudget.currency)) {
    notes.push('Usunięto budżet ze źródła: waluta nie zgadza się z cytatem.');
    sourceBudget = null;
  } else if (sourceBudget && !quoteIsWholeNumber(haystack, sourceBudget.quote)) {
    notes.push('Usunięto budżet ze źródła: cytat zaczyna się lub kończy w środku liczby.');
    sourceBudget = null;
  }

  // D-10: on a bounty source the budget is the reward the adapter parsed, whatever the model said.
  let hiring = hasHiringCue(sourceText);
  if (isBountySource(origin)) {
    const reward = origin.bounty?.reward ?? null;
    if (reward) {
      const given = result.sourceBudget;
      if (
        given &&
        (given.minMinor !== reward.amountMinor || given.maxMinor !== reward.amountMinor)
      ) {
        notes.push('Budżet ze źródła zastąpiono nagrodą podaną w zgłoszeniu.');
      }
      sourceBudget = {
        minMinor: reward.amountMinor,
        maxMinor: reward.amountMinor,
        currency: reward.currency,
        quote: reward.quote,
      };
      hiring = true;
    } else {
      if (result.sourceBudget) {
        notes.push('Usunięto budżet ze źródła: zgłoszenie nie podaje nagrody.');
      }
      sourceBudget = null;
    }
  }

  let { evidenceLevel, category } = result;
  if (evidenceLevel === 'DIRECT_REQUEST' && !hiring) {
    notes.push(
      'Poziom dowodu obniżony do EXPLICIT_PROBLEM: w tekście brak zlecenia lub płatności.',
    );
    evidenceLevel = 'EXPLICIT_PROBLEM';
  }
  if (PAID_CATEGORIES.has(category) && !hiring) {
    notes.push(
      `Kategoria ${category} zmieniona na UNMET_NEED: w tekście brak zlecenia lub płatności.`,
    );
    category = 'UNMET_NEED';
  }

  return { result: { ...result, sourceFacts, sourceBudget, evidenceLevel, category }, notes };
}

const REMOVED = '[usunięto]';
/** For an address shorter than `REMOVED`: a replacement must never make a field longer. */
const REMOVED_SHORT = '[…]';
const MAX_LINK_NOTES = 5;
const LINK = /\b(?:https?:\/\/|www\.)[^\s<>"'\])]+|[\w.+-]+@[\w-]+(?:\.[\w-]+)+/giu;

/** Trailing punctuation is not part of a URL or address; a trailing slash does not change it. */
const linkKey = (link: string): string =>
  link
    .replace(/[.,;:!?]+$/u, '')
    .replace(/\/+$/u, '')
    .toLowerCase();

/** D-12: URLs and e-mail addresses the source does not contain are the model's invention. */
export function removeInventedLinks(
  value: unknown,
  sourceLower: string,
  removed: string[],
): unknown {
  if (typeof value === 'string') {
    return value.replace(LINK, (link) => {
      if (sourceLower.includes(linkKey(link))) return link;
      removed.push(link.slice(0, 80));
      return link.length >= REMOVED.length ? REMOVED : REMOVED_SHORT;
    });
  }
  if (Array.isArray(value)) {
    return value
      .map((item) => removeInventedLinks(item, sourceLower, removed))
      .filter(
        (item) => !(typeof item === 'string' && [REMOVED, REMOVED_SHORT].includes(item.trim())),
      );
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        removeInventedLinks(item, sourceLower, removed),
      ]),
    );
  }
  return value;
}

/**
 * D-14 and D-12: the S-04 checks, then removal of invented URLs and e-mail addresses from every
 * text field (FR-08 AC4) and the buyer rule: a buyer or company the source does not name is a
 * model inference, never confirmed. Names in free prose are not detected.
 */
export function guardAnalysis(
  result: OpportunityAnalysis,
  sourceText: string,
  origin?: GuardOrigin,
): GuardedAnalysis {
  const base = guardAgainstSource(result, sourceText, origin);
  const notes = [...base.notes];
  const sourceLower = sourceText.toLowerCase();
  const removed: string[] = [];
  let guarded = removeInventedLinks(base.result, sourceLower, removed) as OpportunityAnalysis;
  for (const link of removed.slice(0, MAX_LINK_NOTES)) {
    notes.push(`Usunięto adres, którego nie ma w tekście źródła: „${link}”.`);
  }
  if (removed.length > MAX_LINK_NOTES) {
    notes.push(`Usunięto więcej adresów spoza tekstu źródła; łącznie: ${removed.length}.`);
  }

  if (guarded.verdict === 'ANALYSED' && guarded.buyerConfirmed) {
    const buyer = guarded.buyerOrAudience;
    if (buyer === null || !squash(sourceText).includes(squash(buyer))) {
      notes.push('Nabywcę oznaczono jako niepotwierdzonego: nie występuje w tekście źródła.');
      guarded = { ...guarded, buyerConfirmed: false };
    }
  }
  return { result: guarded, notes };
}
