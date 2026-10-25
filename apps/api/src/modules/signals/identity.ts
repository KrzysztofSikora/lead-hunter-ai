import { createHash } from 'node:crypto';

export class InvalidUrlError extends Error {
  constructor(reason: string) {
    super(`invalid source url: ${reason}`);
    this.name = 'InvalidUrlError';
  }
}

const TITLE_MAX_CHARS = 200;

const isTrackingParameter = (name: string): boolean => {
  const lower = name.toLowerCase();
  return lower.startsWith('utm_') || lower === 'fbclid' || lower === 'gclid' || lower === 'ref';
};

/**
 * D-2: identity form of a URL the contract already validated. Throws only as an invariant guard.
 * The query is `URL#search` split at `&`, so kept parameters stay byte-identical and in order.
 */
export function canonicalizeUrl(raw: string): string {
  if (!URL.canParse(raw)) throw new InvalidUrlError('unparsable');
  const url = new URL(raw);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new InvalidUrlError('scheme');
  }
  if (url.username || url.password) throw new InvalidUrlError('user info');

  const path = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, '') || '/' : url.pathname;
  const kept = url.search
    .slice(1)
    .split('&')
    .filter((part) => part !== '' && !isTrackingParameter(part.split('=')[0] ?? ''));
  const query = kept.length > 0 ? `?${kept.join('&')}` : '';
  return `${url.protocol}//${url.host}${path}${query}`;
}

/** D-2: SHA-256 of the normalised text; `null` when nothing is left after normalisation. */
export function contentHash(text: string): string | null {
  const normalised = text.normalize('NFKC').toLowerCase().replace(/\s+/gu, ' ').trim();
  if (normalised === '') return null;
  return createHash('sha256').update(normalised).digest('hex');
}

export interface EvidenceKeys {
  canonicalUrl: string | null;
  contentHash: string | null;
}

/** D-1: a repeat import is evidence only when it brings a URL or a text not yet recorded. */
export function isNewEvidence(existing: readonly EvidenceKeys[], candidate: EvidenceKeys): boolean {
  const newUrl =
    candidate.canonicalUrl !== null &&
    !existing.some((e) => e.canonicalUrl === candidate.canonicalUrl);
  const newText =
    candidate.contentHash !== null &&
    !existing.some((e) => e.contentHash === candidate.contentHash);
  return newUrl || newText;
}

/** D-7: first non-blank line of the text, else the URL as pasted. */
export function deriveTitle(text: string, sourceUrl: string | null): string {
  const line = text.split(/\r\n|\n|\r/).find((l) => l.trim() !== '');
  if (line !== undefined) return line.trim().slice(0, TITLE_MAX_CHARS);
  return sourceUrl ?? '';
}

/** D-7: the whole text, trimmed, CRLF → LF. */
export const normaliseSnippet = (text: string): string => text.trim().replace(/\r\n?/g, '\n');
