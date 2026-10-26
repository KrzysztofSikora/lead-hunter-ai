import type { TenderFacts } from '@lead-hunter/contracts';
import type { FeedItem } from '../../../modules/sources/ports.js';
import {
  buildTenderText,
  findEstimatedValue,
  htmlToText,
  parseNoticeDate,
  valueLine,
} from '../tender-text.js';

/**
 * Every field of a BZP notice is read here and nowhere else (S-18 Risks). The names are
 * `UNVERIFIED`: they come from third-party descriptions of `GET /mo-board/api/v1/notice` and are
 * confirmed or corrected at the Phase 2 human check.
 */
export const BZP_NOTICE_PAGE = 'https://ezamowienia.gov.pl/mo-client-board/bzp/notice-details/id/';
/** The notice type that opens a procedure (`UNVERIFIED` spelling). */
export const BZP_CONTRACT_NOTICE = 'ContractNotice';

const TITLE_MAX = 300;
const BUYER_MAX = 300;
const CPV_MAX = 20;

export type MappedNotice =
  | { kind: 'item'; item: FeedItem; cpvDropped: number }
  /** Not wanted, and not an error: another notice type, or no configured CPV prefix matches. */
  | { kind: 'ignored'; reason: 'notice_type' | 'cpv' }
  /** Cannot be read; the run counts it as skipped (partial). */
  | { kind: 'invalid' };

const text = (value: unknown, max: number): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed.slice(0, max);
};

/** `72000000-5 (Usługi …), 48000000-8` to the codes found. */
export function extractCpvCodes(value: unknown): string[] {
  if (typeof value !== 'string') return [];
  return [...value.slice(0, 5000).matchAll(/\b(\d{8})(?:-(\d))?\b/g)].map(
    (m) => `${m[1]}${m[2] === undefined ? '' : `-${m[2]}`}`,
  );
}

export function mapBzpNotice(
  raw: unknown,
  config: { cpvPrefixes: readonly string[] },
  maxTextChars: number,
): MappedNotice {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { kind: 'invalid' };
  const notice = raw as Record<string, unknown>;
  if (notice.noticeType !== BZP_CONTRACT_NOTICE) return { kind: 'ignored', reason: 'notice_type' };

  const noticeId = text(notice.bzpNumber, 100);
  const objectId = text(notice.objectId, 100);
  const title = text(notice.orderObject, TITLE_MAX);
  if ((noticeId ?? objectId) === null || title === null) return { kind: 'invalid' };
  const id = (noticeId ?? objectId) as string;

  const allCodes = extractCpvCodes(notice.cpvCode);
  if (!allCodes.some((code) => config.cpvPrefixes.some((prefix) => code.startsWith(prefix)))) {
    return { kind: 'ignored', reason: 'cpv' };
  }
  // Plan-review 3: each field is bounded here, so one long field never drops the others.
  const cpvCodes = allCodes.slice(0, CPV_MAX);
  const buyer = text(notice.organizationName, BUYER_MAX);
  const deadline = parseNoticeDate(notice.submittingOffersDate);
  const publishedAt = parseNoticeDate(notice.publicationDate);

  const body = typeof notice.htmlBody === 'string' ? htmlToText(notice.htmlBody) : '';
  const stated = findEstimatedValue(body);
  const line = stated === null ? null : valueLine(stated);
  const bounded = stated !== null && stated.amountMinor <= 100_000_000_000 ? stated : null;

  const facts: TenderFacts = {
    noticeId: id,
    buyer,
    deadlineAt: deadline === null ? null : new Date(deadline).toISOString(),
    estimatedValue:
      bounded === null || line === null
        ? null
        : { amountMinor: bounded.amountMinor, currency: bounded.currency, quote: line },
    // The BZP list cannot say a value is absent (it sits in the HTML), so a miss is `unknown`.
    valueState: bounded === null ? 'unknown' : 'stated',
    cpvCodes,
    procedure: null,
    country: 'PL',
  };
  const item: FeedItem = {
    key: id,
    url: objectId === null ? null : `${BZP_NOTICE_PAGE}${encodeURIComponent(objectId)}`,
    title,
    text: buildTenderText(
      {
        title,
        buyer,
        deadlineAt: deadline,
        valueLine: bounded === null ? null : line,
        cpvCodes,
        noticeId: id,
        description: body,
      },
      maxTextChars,
    ),
    publishedAt,
    tender: facts,
  };
  return { kind: 'item', item, cpvDropped: allCodes.length - cpvCodes.length };
}
