import { WEAK_CATEGORIES, WEAK_EVIDENCE } from '@lead-hunter/contracts';
import type { DigestCandidateRow } from './ports.js';

export const TOP_LIMIT = 5;
export const WEAK_LIMIT = 5;
/** S-13 D-5: Jaccard similarity of title tokens from which two rows are near-duplicates. */
export const SIMILARITY = 0.6;
export const DIGEST_WINDOW_DAYS = 7;
export const CANDIDATE_LIMIT = 200;

export const isWeak = (row: Pick<DigestCandidateRow, 'category' | 'evidenceLevel'>): boolean =>
  WEAK_CATEGORIES.includes(row.category) || WEAK_EVIDENCE.includes(row.evidenceLevel);

/** NFKD, no diacritics, lower case, alphanumeric tokens of at least 3 characters. */
export function tokens(text: string): Set<string> {
  return new Set(
    text
      .normalize('NFKD')
      .replace(/\p{M}+/gu, '')
      .toLowerCase()
      // `ł` has no decomposition
      .replace(/ł/g, 'l')
      .split(/[^\p{L}\p{N}]+/u)
      .filter((token) => token.length >= 3),
  );
}

const textOf = (row: DigestCandidateRow): string => `${row.title} ${row.buyer ?? ''}`;

export function nearDuplicate(a: DigestCandidateRow, b: DigestCandidateRow): boolean {
  const left = tokens(textOf(a));
  const right = tokens(textOf(b));
  if (left.size === 0 || right.size === 0) return false;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  return shared / (left.size + right.size - shared) >= SIMILARITY;
}

/** Direct requests first, then score, newest, highest id (D-6). */
const byPreference = (a: DigestCandidateRow, b: DigestCandidateRow): number =>
  Number(b.evidenceLevel === 'DIRECT_REQUEST') - Number(a.evidenceLevel === 'DIRECT_REQUEST') ||
  b.score - a.score ||
  b.createdAt - a.createdAt ||
  b.id - a.id;

/**
 * Up to `TOP_LIMIT` main-section rows with `score >= minScore`. Every picked row has at most one
 * near-duplicate among the picked (a group of at most 2, also along an A~B~C chain).
 */
export function pickTop(rows: DigestCandidateRow[], minScore: number): DigestCandidateRow[] {
  const picked: DigestCandidateRow[] = [];
  const twins = new Map<number, number>();
  for (const row of rows
    .filter((candidate) => !isWeak(candidate) && candidate.score >= minScore)
    .sort(byPreference)) {
    if (picked.length >= TOP_LIMIT) break;
    const similar = picked.filter((other) => nearDuplicate(row, other));
    if (similar.length > 1 || similar.some((other) => (twins.get(other.id) ?? 0) >= 1)) continue;
    for (const other of similar) twins.set(other.id, (twins.get(other.id) ?? 0) + 1);
    twins.set(row.id, similar.length);
    picked.push(row);
  }
  return picked;
}

/** Weak signals are never thresholded (D-4): best scores, up to `WEAK_LIMIT`. */
export function pickWeak(rows: DigestCandidateRow[]): DigestCandidateRow[] {
  return rows
    .filter(isWeak)
    .sort((a, b) => b.score - a.score || b.createdAt - a.createdAt || b.id - a.id)
    .slice(0, WEAK_LIMIT);
}
