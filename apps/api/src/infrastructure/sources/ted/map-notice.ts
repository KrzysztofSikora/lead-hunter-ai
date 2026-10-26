import { TED_COUNTRY_CODES, type Currency, type TenderFacts } from '@lead-hunter/contracts';
import type { FeedItem } from '../../../modules/sources/ports.js';
import { buildTenderText, htmlToText, parseNoticeDate, valueLine } from '../tender-text.js';
import type { MappedNotice } from '../bzp/map-notice.js';
import { TED_OPENING_TYPES } from './query.js';

/**
 * Every field of a TED search result is read here and nowhere else (S-18 Risks). The names are
 * `UNVERIFIED` (docs.ted.europa.eu and third-party descriptions); they are confirmed or corrected
 * at the Phase 3 human check. This list is also what the adapter asks for in `fields`.
 */
export const TED_FIELDS = [
  'publication-number',
  'notice-type',
  'notice-title',
  'buyer-name',
  'buyer-country',
  'classification-cpv',
  'publication-date',
  'deadline-receipt-tender-date-lot',
  'deadline-receipt-tender-time-lot',
  'estimated-value-lot',
  'estimated-value-cur-lot',
  'estimated-value-proc',
  'estimated-value-cur-proc',
  'description-proc',
  'links',
] as const;

export const TED_NOTICE_PAGE = 'https://ted.europa.eu/en/notice/-/detail/';

const TITLE_MAX = 300;
const BUYER_MAX = 300;
const CPV_MAX = 20;
const DESCRIPTION_MAX_CHARS = 20_000;
const VALUE_MINOR_MAX = 100_000_000_000;
const LANGUAGE_ORDER = ['pol', 'eng'];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const first = (value: unknown): unknown => (Array.isArray(value) ? value[0] : value);

/** A multilingual value (`{ pol: …, eng: … }`, a list, or a plain string): Polish, English, any. */
function localized(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return localized(value[0]);
  if (!isRecord(value)) return null;
  const byLanguage = new Map(Object.entries(value).map(([k, v]) => [k.toLowerCase(), v]));
  for (const language of LANGUAGE_ORDER) {
    const found = localized(byLanguage.get(language));
    if (found !== null && found.trim() !== '') return found;
  }
  for (const entry of byLanguage.values()) {
    const found = localized(entry);
    if (found !== null && found.trim() !== '') return found;
  }
  return null;
}

const text = (value: unknown, max: number): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed.slice(0, max);
};

/** `2026-11-20+01:00` (a date with an offset) becomes a full instant string; others pass. */
function dateTime(date: unknown, time: unknown): number | null {
  if (typeof date !== 'string') return null;
  const match = /^(\d{4}-\d{2}-\d{2})(Z|[+-]\d{2}:?\d{2})?$/.exec(date.trim());
  if (!match) return parseNoticeDate(date);
  const clock =
    typeof time === 'string' ? /^(\d{2}:\d{2}(?::\d{2})?)/.exec(time.trim())?.[1] : undefined;
  const hms = clock === undefined ? '00:00:00' : clock.length === 5 ? `${clock}:00` : clock;
  return parseNoticeDate(`${match[1]}T${hms}${match[2] ?? ''}`);
}

function cpvCodes(value: unknown): string[] {
  const list = Array.isArray(value) ? value : [value];
  return list.flatMap((entry) =>
    typeof entry === 'string' && /^\d{8}$/.test(entry.trim()) ? [entry.trim()] : [],
  );
}

type Value =
  | { kind: 'stated'; amountMinor: number; currency: Currency }
  | { kind: 'absent' }
  | { kind: 'unknown' };

/**
 * The estimated value: the procedure's, else a single lot's. Several lots without a procedure
 * value are not summed (a guess), so the value stays unknown. A missing field is `absent`; an
 * unreadable one is `unknown` (plan-review 2).
 */
function estimatedValue(notice: Record<string, unknown>): Value {
  const procedure = notice['estimated-value-proc'];
  const lots = notice['estimated-value-lot'];
  const present = (v: unknown): boolean =>
    v !== undefined && v !== null && !(Array.isArray(v) && v.length === 0);
  if (!present(procedure) && !present(lots)) return { kind: 'absent' };
  const useProcedure = present(procedure);
  const amounts = useProcedure ? procedure : lots;
  const currencies = notice[useProcedure ? 'estimated-value-cur-proc' : 'estimated-value-cur-lot'];
  const list = Array.isArray(amounts) ? amounts : [amounts];
  if (list.length !== 1) return { kind: 'unknown' };
  const rawAmount = list[0];
  const amount = typeof rawAmount === 'string' ? Number(rawAmount) : rawAmount;
  const currency = Array.isArray(currencies) ? currencies[0] : currencies;
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0)
    return { kind: 'unknown' };
  if (currency !== 'PLN' && currency !== 'EUR' && currency !== 'USD') return { kind: 'unknown' };
  const amountMinor = Math.round(amount * 100);
  if (!Number.isSafeInteger(amountMinor) || amountMinor > VALUE_MINOR_MAX)
    return { kind: 'unknown' };
  return { kind: 'stated', amountMinor, currency };
}

/** The notice page: the link TED gives (https, ted.europa.eu) in Polish, English or any language. */
function noticeUrl(notice: Record<string, unknown>, publicationNumber: string): string {
  const links = notice.links;
  const html = isRecord(links) ? links.html : undefined;
  const candidate = isRecord(html)
    ? localized(
        Object.fromEntries(
          Object.entries(html).map(([k, v]) => [k, typeof v === 'string' ? v : null]),
        ),
      )
    : null;
  if (candidate !== null) {
    try {
      const url = new URL(candidate);
      if (
        url.protocol === 'https:' &&
        (url.hostname === 'ted.europa.eu' || url.hostname.endsWith('.ted.europa.eu'))
      ) {
        return url.href;
      }
    } catch {
      // fall through to the constructed address
    }
  }
  return `${TED_NOTICE_PAGE}${encodeURIComponent(publicationNumber)}`;
}

export function mapTedNotice(
  raw: unknown,
  config: { cpvPrefixes: readonly string[] },
  maxTextChars: number,
): MappedNotice {
  if (!isRecord(raw)) return { kind: 'invalid' };
  const type = raw['notice-type'];
  if (typeof type !== 'string' || !(TED_OPENING_TYPES as readonly string[]).includes(type)) {
    return { kind: 'ignored', reason: 'notice_type' };
  }
  const id = text(first(raw['publication-number']), 100);
  const titleRaw = localized(raw['notice-title']);
  const title = titleRaw === null ? null : text(titleRaw, TITLE_MAX);
  if (id === null || title === null) return { kind: 'invalid' };

  const allCodes = cpvCodes(raw['classification-cpv']);
  if (!allCodes.some((code) => config.cpvPrefixes.some((prefix) => code.startsWith(prefix)))) {
    return { kind: 'ignored', reason: 'cpv' };
  }
  const codes = allCodes.slice(0, CPV_MAX);
  const buyerRaw = localized(raw['buyer-name']);
  const buyer = buyerRaw === null ? null : text(buyerRaw, BUYER_MAX);
  const deadlines = (
    Array.isArray(raw['deadline-receipt-tender-date-lot'])
      ? raw['deadline-receipt-tender-date-lot']
      : [raw['deadline-receipt-tender-date-lot']]
  )
    .map((date, index) =>
      dateTime(
        date,
        Array.isArray(raw['deadline-receipt-tender-time-lot'])
          ? raw['deadline-receipt-tender-time-lot'][index]
          : raw['deadline-receipt-tender-time-lot'],
      ),
    )
    .filter((ms): ms is number => ms !== null);
  // With several lots the earliest deadline is the one the operator must not miss.
  const deadline = deadlines.length === 0 ? null : Math.min(...deadlines);
  const publishedAt = dateTime(first(raw['publication-date']), undefined);
  const value = estimatedValue(raw);
  const line = value.kind === 'stated' ? valueLine(value) : null;
  const countryCode = first(raw['buyer-country']);
  const country =
    typeof countryCode === 'string'
      ? (Object.entries(TED_COUNTRY_CODES).find(([, alpha3]) => alpha3 === countryCode)?.[0] ??
        null)
      : null;
  const descriptionRaw = localized(raw['description-proc']);
  const description =
    descriptionRaw === null ? '' : htmlToText(descriptionRaw).slice(0, DESCRIPTION_MAX_CHARS);

  const facts: TenderFacts = {
    noticeId: id,
    buyer,
    deadlineAt: deadline === null ? null : new Date(deadline).toISOString(),
    estimatedValue:
      value.kind === 'stated' && line !== null
        ? { amountMinor: value.amountMinor, currency: value.currency, quote: line }
        : null,
    valueState: value.kind === 'stated' ? 'stated' : value.kind,
    cpvCodes: codes,
    procedure: type,
    country,
  };
  const item: FeedItem = {
    key: id,
    url: noticeUrl(raw, id),
    title,
    text: buildTenderText(
      {
        title,
        buyer,
        deadlineAt: deadline,
        valueLine: line,
        cpvCodes: codes,
        noticeId: id,
        description,
      },
      maxTextChars,
    ),
    publishedAt,
    tender: facts,
  };
  return { kind: 'item', item, cpvDropped: allCodes.length - codes.length };
}
